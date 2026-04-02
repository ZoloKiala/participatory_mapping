(function () {
  const skipLoader = document.documentElement.classList.contains("skip-loader");
  if (!skipLoader) {
    document.body.classList.add("is-loading");
  }
  const appLoader = document.getElementById("app-loader");
  const pointsLoader = document.getElementById("points-loader");
  if (skipLoader && appLoader) {
    appLoader.classList.add("is-hidden");
  }
  const loaderShownAt = Date.now();
  const minLoaderMs = 1800;
  function hideLoader() {
    if (!appLoader) return;
    const elapsed = Date.now() - loaderShownAt;
    const wait = Math.max(0, minLoaderMs - elapsed);
    window.setTimeout(() => {
      appLoader.classList.add("is-hidden");
      document.body.classList.remove("is-loading");
    }, wait);
  }

  function hidePointsLoader() {
    if (pointsLoader) {
      pointsLoader.classList.add("is-hidden");
    }
  }

  // Failsafe: never leave the app blocked by the loader.
  window.setTimeout(hideLoader, 7000);

  const map = L.map("map").setView([-14.6, 34.9], 7);
  let legendControl = null;
  map.createPane("bufferPane");
  map.getPane("bufferPane").style.zIndex = "350";
  window.addEventListener("load", () => map.invalidateSize({ pan: false }));
  window.addEventListener("resize", () => map.invalidateSize({ pan: false }));
  L.control.scale({ position: "bottomleft" }).addTo(map);

  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
    crossOrigin: true,
  });

  const osmHumanitarian = L.tileLayer(
    "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors, Humanitarian style",
      crossOrigin: true,
    }
  );

  const esriImagery = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri",
      crossOrigin: true,
    }
  );

  const cartoLabels = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      crossOrigin: true,
    }
  );

  const openTopoMap = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        "Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap",
      crossOrigin: true,
    }
  );

  const hybrid = L.layerGroup([esriImagery, cartoLabels]);

  hybrid.addTo(map);

  const failureCounts = new WeakMap();
  function registerBasemapFallback(tileLayer, activeLayer) {
    tileLayer.on("tileerror", () => {
      const failures = (failureCounts.get(tileLayer) || 0) + 1;
      failureCounts.set(tileLayer, failures);
      if (failures >= 3 && activeLayer !== osm && map.hasLayer(activeLayer)) {
        map.removeLayer(activeLayer);
        osm.addTo(map);
      }
    });
  }

  registerBasemapFallback(osmHumanitarian, osmHumanitarian);
  registerBasemapFallback(openTopoMap, openTopoMap);
  registerBasemapFallback(esriImagery, hybrid);
  registerBasemapFallback(cartoLabels, hybrid);

  L.control
    .layers(
      {
        "Google Hybrid (Satellite + Labels)": hybrid,
        "OpenStreetMap": osm,
        "OSM Humanitarian": osmHumanitarian,
        "OpenTopoMap": openTopoMap,
      },
      null,
      { position: "topright" }
    )
    .addTo(map);

  function setupSidebarToggle() {
    const layout = document.querySelector(".layout");
    if (!layout) return;

    const storageKey = "pgis_sidebar_collapsed";
    let button;
    const applyState = (collapsed) => {
      layout.classList.toggle("panel-collapsed", collapsed);
      if (button) {
        button.setAttribute("aria-label", collapsed ? "Show sidebar" : "Hide sidebar");
        button.setAttribute("title", collapsed ? "Show sidebar" : "Hide sidebar");
      }
      map.invalidateSize({ pan: false });
    };

    const SidebarToggleControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-control sidebar-toggle-control");
        const bar = L.DomUtil.create("div", "leaflet-bar", container);
        button = L.DomUtil.create("a", "sidebar-map-toggle", bar);
        button.href = "#";
        button.setAttribute("role", "button");
        button.setAttribute("aria-label", "Hide sidebar");
        button.setAttribute("title", "Hide sidebar");

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(button, "click", (event) => {
          L.DomEvent.preventDefault(event);
          const collapsed = !layout.classList.contains("panel-collapsed");
          applyState(collapsed);
          window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
        });
        return container;
      },
    });

    map.addControl(new SidebarToggleControl());

    const savedCollapsed = window.localStorage.getItem(storageKey) === "1";
    applyState(savedCollapsed);
  }

  function setupMeasureTool() {
    const mapContainer = map.getContainer();
    let isMeasuring = false;
    const measurePoints = [];
    const measureLayer = L.layerGroup().addTo(map);
    let toggleButton = null;
    let clearButton = null;

    function formatDistance(meters) {
      if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
      }
      return `${Math.round(meters)} m`;
    }

    function formatArea(squareMeters) {
      if (squareMeters >= 1000000) {
        return `${(squareMeters / 1000000).toFixed(2)} km²`;
      }
      if (squareMeters >= 10000) {
        return `${(squareMeters / 10000).toFixed(2)} ha`;
      }
      return `${Math.round(squareMeters)} m²`;
    }

    function totalDistance(points) {
      let meters = 0;
      for (let i = 1; i < points.length; i += 1) {
        meters += points[i - 1].distanceTo(points[i]);
      }
      return meters;
    }

    function geodesicArea(points) {
      if (points.length < 3) return 0;
      const d2r = Math.PI / 180;
      const radius = 6378137.0;
      let area = 0;

      for (let i = 0; i < points.length; i += 1) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        area +=
          ((p2.lng - p1.lng) * d2r) *
          (2 + Math.sin(p1.lat * d2r) + Math.sin(p2.lat * d2r));
      }

      return Math.abs((area * radius * radius) / 2.0);
    }

    function updateButtons() {
      if (toggleButton) {
        toggleButton.classList.toggle("is-active", isMeasuring);
        toggleButton.setAttribute(
          "title",
          isMeasuring ? "Stop measuring" : "Start measuring"
        );
        toggleButton.setAttribute(
          "aria-label",
          isMeasuring ? "Stop measuring" : "Start measuring"
        );
      }
      if (clearButton) {
        const hasPoints = measurePoints.length > 0;
        clearButton.classList.toggle("is-disabled", !hasPoints);
        clearButton.setAttribute("aria-disabled", hasPoints ? "false" : "true");
      }
      mapContainer.classList.toggle("is-measuring", isMeasuring);
    }

    function renderMeasurement() {
      measureLayer.clearLayers();
      let polygonLayer = null;

      measurePoints.forEach((point) => {
        L.circleMarker(point, {
          radius: 5,
          color: "#0b1720",
          weight: 1,
          fillColor: "#f97316",
          fillOpacity: 1,
          opacity: 1,
        }).addTo(measureLayer);
      });

      if (measurePoints.length >= 2) {
        L.polyline(measurePoints, {
          color: "#f97316",
          weight: 3,
          opacity: 1,
          dashArray: "9 6",
        }).addTo(measureLayer);

        let distanceMeters = totalDistance(measurePoints);
        let distanceLabel = formatDistance(distanceMeters);

        if (measurePoints.length >= 3) {
          polygonLayer = L.polygon(measurePoints, {
            color: "#f97316",
            weight: 1,
            fillColor: "#f97316",
            fillOpacity: 0.12,
            opacity: 0.65,
          }).addTo(measureLayer);
          distanceMeters += measurePoints[measurePoints.length - 1].distanceTo(measurePoints[0]);
          distanceLabel = `Perimeter: ${formatDistance(distanceMeters)}`;
        }

        const endPoint = measurePoints[measurePoints.length - 1];
        L.marker(endPoint, {
          interactive: false,
          icon: L.divIcon({
            className: "measure-distance-label",
            html: `<span>${distanceLabel}</span>`,
          }),
        }).addTo(measureLayer);

        if (polygonLayer) {
          const areaMeters = geodesicArea(measurePoints);
          const center = polygonLayer.getBounds().getCenter();
          L.marker(center, {
            interactive: false,
            icon: L.divIcon({
              className: "measure-area-label",
              html: `<span>Area: ${formatArea(areaMeters)}</span>`,
            }),
          }).addTo(measureLayer);
        }
      }

      updateButtons();
    }

    function clearMeasurement() {
      measurePoints.length = 0;
      measureLayer.clearLayers();
      updateButtons();
    }

    const MeasureControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-control measure-control");
        const bar = L.DomUtil.create("div", "leaflet-bar", container);

        toggleButton = L.DomUtil.create("a", "measure-map-toggle", bar);
        toggleButton.href = "#";
        toggleButton.setAttribute("role", "button");
        toggleButton.setAttribute("title", "Start measuring");
        toggleButton.setAttribute("aria-label", "Start measuring");

        clearButton = L.DomUtil.create("a", "measure-map-clear", bar);
        clearButton.href = "#";
        clearButton.setAttribute("role", "button");
        clearButton.setAttribute("title", "Clear measurement");
        clearButton.setAttribute("aria-label", "Clear measurement");

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(toggleButton, "click", (event) => {
          L.DomEvent.preventDefault(event);
          isMeasuring = !isMeasuring;
          updateButtons();
        });
        L.DomEvent.on(clearButton, "click", (event) => {
          L.DomEvent.preventDefault(event);
          clearMeasurement();
        });

        updateButtons();
        return container;
      },
    });

    map.addControl(new MeasureControl());
    map.on("click", (event) => {
      if (!isMeasuring) return;
      measurePoints.push(event.latlng);
      renderMeasurement();
    });
  }

  const indicatorPalette = [
    "#1d4ed8",
    "#16a34a",
    "#b91c1c",
    "#f97316",
    "#7c3aed",
    "#0f766e",
    "#be185d",
    "#4338ca",
    "#15803d",
    "#c2410c",
    "#334155",
    "#a16207",
  ];

  function indicatorLabel(value) {
    const normalized = normalizeIssueLabel(value);
    if (!normalized) return "Unspecified";
    if (normalized === "grazing pressure high") return "High Grazing Pressure";
    if (normalized === "contour bund") return "Contour Bund (CB)";
    if (normalized === "cb plus") return "CB+ (Contour Bund in Good Condition)";
    if (normalized === "cb minus") return "CB- (Contour Bund in Bad Condition)";
    if (normalized === "dam") return "Dam (Priority)";
    if (normalized === "d plus") return "D+ (Dam in Good Condition)";
    if (normalized === "d minus") return "D- (Dam in Bad Condition)";
    if (normalized === "land tenure") return "Land tenure issues";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  function popupLabel(value) {
    return (value || "")
      .toString()
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeIssueLabel(value) {
    let normalized = (value || "")
      .toString()
      .toLowerCase()
      .replace("d+ (dam in good condition)", "d plus")
      .replace("d- (dam in bad condition)", "d minus")
      .replace("cb+ (contour bund in good condition)", "cb plus")
      .replace("cb- (contour bund in bad condition)", "cb minus")
      .replace(/[()]/g, "")
      .replace(/[^a-z0-9\s_-]+/g, " ")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace("wild life", "wildlife")
      .replace("river bank", "riverbank")
      .replace("land tenure issues", "land tenure")
      .replace("bore hole", "borehole")
      .replace("good condition contour bund", "cb plus")
      .replace("bad condition contour bund", "cb minus")
      .replace("good contour bund", "cb plus")
      .replace("bad contour bund", "cb minus")
      .replace("cb+", "cb plus")
      .replace("cb-", "cb minus")
      .replace("good condition dam", "d plus")
      .replace("bad condition dam", "d minus")
      .replace("priority dam", "dam")
      .replace("d+", "d plus")
      .replace("d-", "d minus")
      .replace("fertilty", "fertility")
      .replace("yield decline", "yield loss")
      .replace("nutrient loss areas", "nutrient loss")
      .replace("nutrient loss area", "nutrient loss")
      .replace("riverbank collapsed", "riverbank collapse")
      .replace("seasonal stream", "stream seasonal")
      .replace("gulley", "gully");

    if (normalized === "flooding") {
      normalized = "flood";
    }

    if (normalized.includes("grazing")) {
      return "grazing pressure high";
    }

    const parts = normalized.split(" ");
    const singularTail = {
      conflicts: "conflict",
      disputes: "dispute",
      corridors: "corridor",
      wetlands: "wetland",
      yields: "yield",
    };
    if (parts.length) {
      const last = parts[parts.length - 1];
      parts[parts.length - 1] = singularTail[last] || last;
    }

    return parts.join(" ");
  }

  function buildIndicatorColorMap(features) {
    const canonicalKeys = new Set();
    features.forEach((feature) => {
      const key = normalizeIssueLabel(indicatorLabel(feature?.properties?.indicator));
      if (key) canonicalKeys.add(key);
    });

    const keys = Array.from(canonicalKeys).sort((a, b) => a.localeCompare(b));

    const mapByIndicator = new Map();
    keys.forEach((key, index) => {
      mapByIndicator.set(key, {
        label: key,
        color: indicatorPalette[index % indicatorPalette.length],
      });
    });
    return mapByIndicator;
  }

  function indicatorColor(indicatorColors, value) {
    const key = normalizeIssueLabel(indicatorLabel(value));
    return indicatorColors.get(key)?.color || "#334155";
  }

  function severityLabel(value) {
    if (value === null || value === undefined || value === "") return "-";
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return `${value}`;
    if (numeric <= 1) return `Low (${numeric})`;
    if (numeric <= 3) return `Moderate (${numeric})`;
    return `High (${numeric})`;
  }

  function addLegendControl(indicatorColors) {
    document
      .querySelectorAll(".leaflet-control .map-legend")
      .forEach((legendNode) => {
        const controlNode = legendNode.closest(".leaflet-control");
        if (controlNode && controlNode.parentNode) {
          controlNode.parentNode.removeChild(controlNode);
        }
      });

    if (legendControl) {
      map.removeControl(legendControl);
      legendControl = null;
    }

    const legend = L.control({ position: "topright" });

    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "map-legend");
      const seen = new Set();
      const rows = Array.from(indicatorColors.values())
        .filter(({ label }) => {
          const dedupeKey = normalizeIssueLabel(label);
          if (seen.has(dedupeKey)) return false;
          seen.add(dedupeKey);
          return true;
        })
        .map(
          ({ label, color }) =>
            `<div class="row"><span class="swatch" style="background:${color}"></span><span>${indicatorLabel(label)}</span></div>`
        )
        .join("");
      div.innerHTML = `<h4>Hotspots</h4>${rows}`;
      return div;
    };

    legend.addTo(map);
    legendControl = legend;
  }

  function centerOnFeatures(features, layer) {
    map.invalidateSize({ pan: false });
    let hasDistrictFilter = false;
    try {
      const parsedUrl = new URL(window.PGIS?.locationsUrl, window.location.origin);
      hasDistrictFilter = !!parsedUrl.searchParams.get("district");
    } catch (e) {}

    if (!features.length) {
      map.setView([-14.6, 34.9], 7);
      return;
    }

    if (features.length === 1) {
      const coords = features[0]?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        map.setView([coords[1], coords[0]], 12);
        return;
      }
    }

    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      const paddedBounds = bounds.pad(0.06);
      map.fitBounds(paddedBounds, {
        maxZoom: 15,
        animate: false,
        paddingTopLeft: [20, 20],
        paddingBottomRight: [20, 20],
      });
      const targetZoom = hasDistrictFilter ? 14 : 8;
      map.setView(paddedBounds.getCenter(), targetZoom, { animate: false });
    }
  }

  setupSidebarToggle();
  setupMeasureTool();

  const filterForm = document.querySelector("form.filters");
  if (filterForm) {
    let submitting = false;
    filterForm.addEventListener("submit", (event) => {
      if (submitting) {
        return;
      }
      event.preventDefault();
      submitting = true;

      const applyBtn = filterForm.querySelector(".apply-btn");
      if (applyBtn) {
        applyBtn.classList.add("is-loading");
        applyBtn.disabled = true;
        const label = applyBtn.querySelector(".apply-btn-label");
        if (label && label.dataset.loading) {
          label.textContent = label.dataset.loading;
        }
      }
      try {
        window.sessionStorage.setItem("pgis_skip_loader_once", "1");
      } catch (e) {}

      // Allow at least one paint so spinner is visible before navigation.
      window.requestAnimationFrame(() => {
        window.setTimeout(() => filterForm.submit(), 450);
      });
    });
  }

  function setupIndicatorGroupsCollapsible() {
    const groups = Array.from(document.querySelectorAll("details.indicator-group"));
    if (!groups.length) return;

    const selectedIndicators = Array.from(
      document.querySelectorAll('input[name="indicator"]:checked')
    );
    if (selectedIndicators.length) {
      const selectedGroups = new Set();
      selectedIndicators.forEach((input) => {
        const group = input.closest("details.indicator-group");
        if (group) selectedGroups.add(group);
      });
      selectedGroups.forEach((group) => {
        group.open = true;
      });
    }

    groups.forEach((group) => {
      group.addEventListener("toggle", () => {
        if (!group.open) return;
        const hasSelectedIndicators = !!document.querySelector(
          'input[name="indicator"]:checked'
        );
        if (hasSelectedIndicators) return;
        groups.forEach((otherGroup) => {
          if (otherGroup !== group) {
            otherGroup.open = false;
          }
        });
      });
    });
  }

  setupIndicatorGroupsCollapsible();

  function setupIndicatorGroupToggles() {
    const groups = Array.from(document.querySelectorAll("details.indicator-group"));
    if (!groups.length) return;

    groups.forEach((group) => {
      const toggle = group.querySelector("[data-indicator-group-toggle]");
      const inputs = Array.from(
        group.querySelectorAll('input[name="indicator"]')
      );
      if (!toggle || !inputs.length) return;

      const syncToggleState = () => {
        const checkedCount = inputs.filter((input) => input.checked).length;
        toggle.checked = checkedCount === inputs.length;
        toggle.indeterminate = checkedCount > 0 && checkedCount < inputs.length;
      };

      toggle.addEventListener("change", () => {
        const shouldSelectAll = toggle.checked;
        inputs.forEach((input) => {
          input.checked = shouldSelectAll;
        });
        syncToggleState();
      });

      inputs.forEach((input) => {
        input.addEventListener("change", syncToggleState);
      });

      syncToggleState();
    });
  }

  setupIndicatorGroupToggles();

  function setupMapSearchToggle() {
    const container = document.querySelector(".map-search-control");
    if (!container) return;
    const toggle = container.querySelector(".map-search-toggle");
    const input = container.querySelector('input[name="q"]');
    if (!toggle || !input) return;
    const initialQuery = input.value.trim();
    let hadQuery = !!initialQuery;
    let clearingInProgress = false;

    const submitWithoutSearch = () => {
      if (!filterForm || clearingInProgress) return;
      clearingInProgress = true;
      input.value = "";
      if (typeof filterForm.requestSubmit === "function") {
        filterForm.requestSubmit();
      } else {
        filterForm.submit();
      }
    };

    const setOpen = (isOpen) => {
      container.classList.toggle("is-open", isOpen);
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      if (isOpen) {
        window.requestAnimationFrame(() => input.focus());
      }
    };

    toggle.addEventListener("click", () => {
      setOpen(!container.classList.contains("is-open"));
    });

    input.addEventListener("input", () => {
      const value = input.value.trim();
      if (value) {
        hadQuery = true;
        return;
      }
      if (hadQuery) {
        hadQuery = false;
        submitWithoutSearch();
      }
    });

    document.addEventListener("click", (event) => {
      if (!container.classList.contains("is-open")) return;
      if (container.contains(event.target)) return;
      if (input.value.trim()) return;
      setOpen(false);
    });
  }

  setupMapSearchToggle();

  function setupHotspotHighlight(layer, indicatorColors) {
    const hotspotButtons = Array.from(document.querySelectorAll(".hotspot-item"));
    if (!hotspotButtons.length || !layer) return;

    const applyBaseStyle = (markerLayer) => {
      const rawIndicator = indicatorLabel(
        markerLayer.feature?.properties?.indicator
      );
      markerLayer.setStyle({
        weight: 1,
        color: "#0b1720",
        fillColor: indicatorColor(indicatorColors, rawIndicator),
        fillOpacity: 1,
        opacity: 1,
      });
    };

    const applyDimStyle = (markerLayer) => {
      markerLayer.setStyle({
        weight: 1,
        color: "#64748b",
        fillColor: "#cbd5e1",
        fillOpacity: 0.2,
        opacity: 0.25,
      });
    };

    const clearHotspotSelection = () => {
      hotspotButtons.forEach((button) => {
        button.classList.remove("is-active");
        button.setAttribute("aria-pressed", "false");
      });
      layer.eachLayer((markerLayer) => {
        applyBaseStyle(markerLayer);
      });
    };

    hotspotButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const wasActive = button.classList.contains("is-active");
        clearHotspotSelection();
        if (wasActive) return;

        button.classList.add("is-active");
        button.setAttribute("aria-pressed", "true");

        const selectedIssue = normalizeIssueLabel(button.textContent || "");
        layer.eachLayer((markerLayer) => {
          const markerIssue = normalizeIssueLabel(
            markerLayer.feature?.properties?.indicator || ""
          );
          const isMatch = markerIssue === selectedIssue;
          if (isMatch) {
            markerLayer.setStyle({
              weight: 2,
              color: "#8a6a00",
              fillColor: "#facc15",
              fillOpacity: 1,
              opacity: 1,
            });
            if (typeof markerLayer.bringToFront === "function") {
              markerLayer.bringToFront();
            }
          } else {
            applyDimStyle(markerLayer);
          }
        });
      });
    });
  }

  function setupSkipLoaderLinks() {
    const skipLoaderLinks = Array.from(
      document.querySelectorAll('a[data-skip-loader="1"]')
    );
    if (!skipLoaderLinks.length) return;

    skipLoaderLinks.forEach((link) => {
      link.addEventListener("click", () => {
        try {
          window.sessionStorage.setItem("pgis_skip_loader_once", "1");
        } catch (e) {}
      });
    });
  }

  setupSkipLoaderLinks();

  fetch(window.PGIS.locationsUrl)
    .then((response) => response.json())
    .then((geojson) => {
      const features = geojson.features || [];
      const indicatorColors = buildIndicatorColorMap(features);
      const layer = L.geoJSON(geojson, {
        pointToLayer: (feature, latlng) => {
          const issueKey = normalizeIssueLabel(feature?.properties?.indicator);
          const issueColor = indicatorColor(indicatorColors, feature?.properties?.indicator);
          if (issueKey === "borehole") {
            return L.circleMarker(latlng, {
              radius: 4,
              pane: "bufferPane",
              weight: 1,
              color: "#0b1720",
              opacity: 1,
              fillColor: issueColor,
              fillOpacity: 1,
            });
          }
          return L.circle(latlng, {
            radius: 100,
            pane: "bufferPane",
            weight: 1,
            color: "#0b1720",
            opacity: 1,
            fillColor: issueColor,
            fillOpacity: 1,
          });
        },
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          layer.bindPopup(
            `<strong>${popupLabel(p.label || p.name) || "-"}</strong><br>` +
            `District: ${p.district || "-"}<br>` +
            `Environmental Hotspots: ${indicatorLabel(p.indicator)}<br>` +
            `Severity: ${severityLabel(p.severity)}`
          );
        },
      }).addTo(map);

      requestAnimationFrame(() => {
        centerOnFeatures(features, layer);
        hideLoader();
        hidePointsLoader();
      });

      addLegendControl(indicatorColors);
      setupHotspotHighlight(layer, indicatorColors);
    })
    .catch((err) => {
      // Keep map usable even if data fails to load.
      console.error("Failed to load locations", err);
      hideLoader();
      hidePointsLoader();
    });

})();
