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

  function buildIndicatorColorMap(features) {
    const labels = Array.from(
      new Set(
        features.map((feature) => indicatorLabel(feature?.properties?.indicator))
      )
    ).sort((a, b) => a.localeCompare(b));

    const mapByIndicator = new Map();
    labels.forEach((label, index) => {
      mapByIndicator.set(label, indicatorPalette[index % indicatorPalette.length]);
    });
    return mapByIndicator;
  }

  function addLegendControl(indicatorColors) {
    const legend = L.control({ position: "topright" });

    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "map-legend");
      const rows = Array.from(indicatorColors.entries())
        .map(
          ([indicator, color]) =>
            `<div class="row"><span class="swatch" style="background:${color}"></span><span>${indicator}</span></div>`
        )
        .join("");
      div.innerHTML = `<h4>Indicators</h4>${rows}`;
      return div;
    };

    legend.addTo(map);
  }

  function centerOnFeatures(features, layer) {
    map.invalidateSize({ pan: false });

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
      map.setView(paddedBounds.getCenter(), map.getZoom(), { animate: false });
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

  fetch(window.PGIS.locationsUrl)
    .then((response) => response.json())
    .then((geojson) => {
      const features = geojson.features || [];
      const indicatorColors = buildIndicatorColorMap(features);
      const layer = L.geoJSON(geojson, {
        pointToLayer: (feature, latlng) =>
          L.circleMarker(latlng, {
            radius: 5,
            weight: 1,
            color: "#0b1720",
            fillColor: indicatorColors.get(
              indicatorLabel(feature.properties.indicator)
            ),
            fillOpacity: 0.9,
          }),
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          layer.bindPopup(
            `<strong>${p.label || p.name}</strong><br>` +
            `District: ${p.district || "-"}<br>` +
            `Indicator: ${p.indicator || "-"}<br>` +
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
    })
    .catch((err) => {
      // Keep map usable even if data fails to load.
      console.error("Failed to load locations", err);
      hideLoader();
      hidePointsLoader();
    });

})();
