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
    return (value || "").toString().trim() || "Unspecified";
  }

  function normalizeIssueLabel(value) {
    let normalized = (value || "")
      .toString()
      .toLowerCase()
      .replace(/[()]/g, "")
      .replace(/[^a-z0-9\s_-]+/g, " ")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace("wild life", "wildlife")
      .replace("river bank", "riverbank")
      .replace("land tenure issues", "land tenure")
      .replace("bore hole", "borehole")
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
            `<div class="row"><span class="swatch" style="background:${color}"></span><span>${label}</span></div>`
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

  function setupMapSearchToggle() {
    const container = document.querySelector(".map-search-control");
    if (!container) return;
    const toggle = container.querySelector(".map-search-toggle");
    const input = container.querySelector('input[name="q"]');
    if (!toggle || !input) return;

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
            applyBaseStyle(markerLayer);
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
          const issueColor = indicatorColor(indicatorColors, feature?.properties?.indicator);
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
            `<strong>${p.label || p.name}</strong><br>` +
            `District: ${p.district || "-"}<br>` +
            `Environmental issue: ${p.indicator || "-"}<br>` +
            `Severity: ${p.severity ?? "-"}`
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
