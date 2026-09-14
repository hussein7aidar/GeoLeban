let currentTheme = "light";
let currentMode = "gov";
let currentLang = "ar";
const featuresByName = { gov: {}, caza: {}, city: {} };
const mapLabelLayerIds = [];
let labelsVisible = false;
// Cached localized list of the current mode's places, used by the search box.
let placeOptions = [];

const map = new maplibregl.Map({
  container: "map",
  style: MAP_DEFAULTS.style,
  center: MAP_DEFAULTS.center,
  zoom: MAP_DEFAULTS.zoom,
  pitch: MAP_DEFAULTS.pitch,
  bearing: MAP_DEFAULTS.bearing,
  maxPitch: MAP_DEFAULTS.maxPitch,
  attributionControl: false,
});

// Only show the grabbing hand while the map is actually being dragged.
map.on("dragstart", () => {
  map.getCanvasContainer().classList.add("dragging");
});
map.on("dragend", () => {
  map.getCanvasContainer().classList.remove("dragging");
});

function getResponsivePadding() {
  const isMobile = window.innerWidth <= 600;
  return {
    top: isMobile ? 140 : 100,
    bottom: isMobile ? 80 : 60,
    left: isMobile ? 24 : 60,
    right: isMobile ? 24 : 60,
  };
}

map.on("style.load", () => {
  map.getStyle().layers.forEach((layer) => {
    if (layer.type === "symbol") {
      map.setLayoutProperty(layer.id, "visibility", "none");
      if (mapLabelLayerIds.indexOf(layer.id) === -1) {
        mapLabelLayerIds.push(layer.id);
      }
    }
  });
  applyLabelVisibility();

  if (typeof LEBANON_DATA !== "undefined")
    setupDataset("gov", "lebanon-govs", LEBANON_DATA);
  if (typeof CAZAS_DATA !== "undefined")
    setupDataset("caza", "lebanon-cazas", CAZAS_DATA);
  if (typeof CITIES_DATA !== "undefined")
    setupDataset("city", "lebanon-cities", CITIES_DATA);

  initGameLayers();
  updateUiText();
  updateLayerVisibilities();
  updateHud();

  populateDropdown(DEFAULT_SELECTION);
  selectItem(DEFAULT_SELECTION);
});

map.on("rotate", updateHud);
map.on("pitch", updateHud);
map.on("zoom", updateHud);

function updateHud() {
  const bearing = Math.round(map.getBearing());
  const normBearing = (bearing + 360) % 360;
  const pitch = Math.round(map.getPitch());
  const zoom = map.getZoom();

  document.getElementById("compass-needle").style.transform =
    `rotate(${-bearing}deg)`;
  document.getElementById("val-bearing").textContent = `${normBearing}°`;

  document.getElementById("val-pitch").textContent = `${pitch}°`;
  document.getElementById("pitch-horizon").style.transform =
    `translateY(${pitch * 0.28}px) rotate(${bearing * 0.3}deg)`;

  const approxAltKm = Math.round(35000 / Math.pow(2, zoom));
  document.getElementById("val-alt").textContent =
    approxAltKm >= 1
      ? `${approxAltKm} km`
      : `${Math.round(approxAltKm * 1000)} m`;
  document.getElementById("val-zoom").textContent = `Z: ${zoom.toFixed(1)}`;
}

function resetHeading() {
  map.easeTo({ bearing: 0, pitch: 0, duration: 800 });
}

function setupDataset(modeKey, sourceId, dataset) {
  const nameExpr = [
    "coalesce",
    ["get", "shapeName"],
    ["get", "admin1Name"],
    ["get", "admin2Name"],
  ];

  dataset.features.forEach((feat) => {
    const name =
      feat.properties.shapeName ||
      feat.properties.admin1Name ||
      feat.properties.admin2Name;
    featuresByName[modeKey][name] = feat;

    // Cities ship with an Arabic name (nameAr); English/French fall back to
    // the Latin spelling. Register them so getTranslatedName() finds them.
    if (modeKey === "city" && name && !TRANSLATIONS.names[name]) {
      TRANSLATIONS.names[name] = {
        ar: feat.properties.nameAr || name,
        en: name,
        fr: name,
      };
    }
  });

  let fillMatch;
  let strokeMatch;

  if (modeKey === "city") {
    // 1,500+ areas: colour by parent district instead of one colour each.
    const districtMatch = ["match", ["get", "district"]];
    const colors = {};
    dataset.features.forEach((feat) => {
      const district = feat.properties.district;
      if (district && !(district in colors)) {
        colors[district] =
          PALETTE[Object.keys(colors).length % PALETTE.length];
        districtMatch.push(district, colors[district]);
      }
    });
    districtMatch.push("#64748b");
    fillMatch = districtMatch;
    strokeMatch = districtMatch.slice();
    strokeMatch[strokeMatch.length - 1] = "#334155";
  } else {
    fillMatch = ["match", nameExpr];
    strokeMatch = ["match", nameExpr];
    dataset.features.forEach((feat, idx) => {
      const name =
        feat.properties.shapeName ||
        feat.properties.admin1Name ||
        feat.properties.admin2Name;
      const color = PALETTE[idx % PALETTE.length];
      fillMatch.push(name, color);
      strokeMatch.push(name, color);
    });
    fillMatch.push("#64748b");
    strokeMatch.push("#334155");
  }

  map.addSource(sourceId, { type: "geojson", data: dataset });

  map.addLayer({
    id: `${sourceId}-fill`,
    type: "fill",
    source: sourceId,
    paint: {
      "fill-color": fillMatch,
      "fill-opacity": 0.38,
    },
  });

  map.addLayer({
    id: `${sourceId}-stroke`,
    type: "line",
    source: sourceId,
    paint: {
      "line-color": strokeMatch,
      "line-width": modeKey === "gov" ? 2.2 : modeKey === "city" ? 0.9 : 1.6,
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: `${sourceId}-focus-stroke`,
    type: "line",
    source: sourceId,
    paint: {
      "line-color": currentTheme === "dark" ? "#f1f5f9" : "#0f172a",
      "line-width": 3.5,
      "line-opacity": 1,
    },
    filter: [
      "==",
      [
        "coalesce",
        ["get", "shapeName"],
        ["get", "admin1Name"],
        ["get", "admin2Name"],
      ],
      "",
    ],
  });
}

function setTheme(theme) {
  currentTheme = theme;
  document.body.setAttribute("data-theme", theme);
  document
    .getElementById("btn-light")
    .classList.toggle("active", theme === "light");
  document
    .getElementById("btn-dark")
    .classList.toggle("active", theme === "dark");

  const strokeColor = theme === "dark" ? "#f1f5f9" : "#0f172a";
  if (map.getLayer("lebanon-govs-focus-stroke")) {
    map.setPaintProperty(
      "lebanon-govs-focus-stroke",
      "line-color",
      strokeColor,
    );
  }
  if (map.getLayer("lebanon-cazas-focus-stroke")) {
    map.setPaintProperty(
      "lebanon-cazas-focus-stroke",
      "line-color",
      strokeColor,
    );
  }
  if (map.getLayer("lebanon-cities-focus-stroke")) {
    map.setPaintProperty(
      "lebanon-cities-focus-stroke",
      "line-color",
      strokeColor,
    );
  }

  persistPreference({ theme: theme });
}

function setLanguage(lang) {
  currentLang = lang;
  ["ar", "en", "fr"].forEach((l) => {
    document.getElementById(`lang-${l}`).classList.toggle("active", l === lang);
  });

  updateUiText();
  const select = document.getElementById("item-select");
  populateDropdown(select.value);
  if (typeof window.applyGameTranslations === "function") {
    window.applyGameTranslations();
  }
  persistPreference({ language: lang });
}

/**
 * Persists a user preference to local storage and (when signed in) to the
 * user's profile. Defined here so setTheme/setLanguage can always call it.
 */
function persistPreference(patch) {
  if (
    typeof Backend !== "undefined" &&
    Backend &&
    typeof Backend.savePreferences === "function"
  ) {
    Backend.savePreferences(patch);
  }
}

function updateUiText() {
  const t = TRANSLATIONS.ui[currentLang];

  document.getElementById("btn-gov").textContent = t.gov;
  document.getElementById("btn-caza").textContent = t.caza;
  document.getElementById("btn-city").textContent = t.city;
  document.getElementById("btn-reset").title = t.resetTip;

  const search = document.getElementById("item-search");
  if (search) search.placeholder = t.searchPlaceholder || "";
  const searchBtn = document.getElementById("item-search-btn");
  if (searchBtn) searchBtn.title = t.searchBtn || "";

  document.getElementById("lbl-compass").textContent = t.compass;
  document.getElementById("lbl-tilt").textContent = t.tilt;
  document.getElementById("lbl-alt").textContent = t.alt;
}

function resolveFeatureKey(mode, targetName) {
  if (!targetName || targetName === "all") return "all";

  const available = Object.keys(featuresByName[mode]);
  if (available.length === 0) return "all";
  if (available.includes(targetName)) return targetName;

  const clean = (str) =>
    str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const normTarget = clean(targetName);
  const exactNormalized = available.find((k) => clean(k) === normTarget);
  if (exactNormalized) return exactNormalized;

  const prefix = normTarget.slice(0, 4);
  const prefixMatch = available.find((k) => clean(k).startsWith(prefix));
  if (prefixMatch) return prefixMatch;

  return "all";
}

function setMode(mode, opts) {
  if (mode === "caza" && typeof CAZAS_DATA === "undefined") {
    const strings = (TRANSLATIONS.game && TRANSLATIONS.game[currentLang]) || {};
    const message = strings.dataMissing || "District data could not be loaded.";
    if (typeof window.showAlert === "function") {
      window.showAlert(strings.title || "", message);
    } else {
      console.warn(message);
    }
    return;
  }
  if (mode === "city" && typeof CITIES_DATA === "undefined") {
    const strings = (TRANSLATIONS.game && TRANSLATIONS.game[currentLang]) || {};
    const message = strings.dataMissing || "City data could not be loaded.";
    if (typeof window.showAlert === "function") {
      window.showAlert(strings.title || "", message);
    } else {
      console.warn(message);
    }
    return;
  }

  currentMode = mode;
  document.getElementById("btn-gov").classList.toggle("active", mode === "gov");
  document
    .getElementById("btn-caza")
    .classList.toggle("active", mode === "caza");
  document
    .getElementById("btn-city")
    .classList.toggle("active", mode === "city");

  updateLayerVisibilities();

  populateDropdown(DEFAULT_SELECTION);
  selectItem(DEFAULT_SELECTION, opts);
}

function sourceIdForMode(mode) {
  if (mode === "caza") return "lebanon-cazas";
  if (mode === "city") return "lebanon-cities";
  return "lebanon-govs";
}

function populateDropdown(targetValue = "all") {
  const items = Object.keys(featuresByName[currentMode]);
  placeOptions = items
    .map((rawName) => ({
      raw: rawName,
      label: getTranslatedName(rawName, currentLang),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, currentLang));

  renderPlaceOptions("", resolveFeatureKey(currentMode, targetValue));

  // Reset the search box and suggestions whenever the list is rebuilt.
  const search = document.getElementById("item-search");
  if (search) search.value = "";
  renderSuggestions("");
}

// Rebuilds the <select> from the cached list, optionally filtered by a search
// query on the *localized* label (so AR searches Arabic names, EN English, ...).
function renderPlaceOptions(query, selectedRaw) {
  const select = document.getElementById("item-select");
  if (!select) return;
  const ui = TRANSLATIONS.ui[currentLang];
  const q = (query || "").trim().toLowerCase();
  const matches = q
    ? placeOptions.filter((o) => o.label.toLowerCase().indexOf(q) !== -1)
    : placeOptions;

  // Keep the current selection in the list even when it doesn't match, so the
  // closed select never goes blank or silently jumps to "all".
  let list = matches;
  if (
    selectedRaw &&
    selectedRaw !== "all" &&
    !matches.some((o) => o.raw === selectedRaw)
  ) {
    const current = placeOptions.find((o) => o.raw === selectedRaw);
    if (current) list = [current].concat(matches);
  }

  select.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = ui.overview;
  select.appendChild(allOpt);

  list.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.raw;
    opt.textContent = item.label;
    select.appendChild(opt);
  });

  const desired =
    selectedRaw && selectedRaw !== "all" ? selectedRaw : "all";
  const exists = Array.from(select.options).some((o) => o.value === desired);
  select.value = exists ? desired : "all";
}

function filterItemOptions(term) {
  const select = document.getElementById("item-select");
  renderPlaceOptions(term, select ? select.value : "all");
}

function updateLayerVisibilities() {
  const showGov = currentMode === "gov" ? "visible" : "none";
  const showCaza = currentMode === "caza" ? "visible" : "none";
  const showCity = currentMode === "city" ? "visible" : "none";

  ["fill", "stroke", "focus-stroke"].forEach((type) => {
    if (map.getLayer(`lebanon-govs-${type}`))
      map.setLayoutProperty(`lebanon-govs-${type}`, "visibility", showGov);
    if (map.getLayer(`lebanon-cazas-${type}`))
      map.setLayoutProperty(`lebanon-cazas-${type}`, "visibility", showCaza);
    if (map.getLayer(`lebanon-cities-${type}`))
      map.setLayoutProperty(`lebanon-cities-${type}`, "visibility", showCity);
  });
}

function selectItem(name, opts) {
  const skipCamera = !!(opts && opts.skipCamera);
  const resolvedName = resolveFeatureKey(currentMode, name);
  const select = document.getElementById("item-select");

  if (select && select.value !== resolvedName) {
    select.value = resolvedName;
  }

  const sourceId = sourceIdForMode(currentMode);
  if (!map.getLayer(`${sourceId}-fill`)) return;

  if (resolvedName === "all") {
    const currentDefaults = getResponsiveDefaults();
    map.setPaintProperty(`${sourceId}-fill`, "fill-opacity", 0.38);
    map.setFilter(`${sourceId}-focus-stroke`, [
      "==",
      [
        "coalesce",
        ["get", "shapeName"],
        ["get", "admin1Name"],
        ["get", "admin2Name"],
      ],
      "",
    ]);
    if (!skipCamera) {
      map.flyTo({
        center: currentDefaults.center,
        zoom: currentDefaults.zoom,
        pitch: 0,
        bearing: 0,
        duration: 1100,
      });
    }
    return;
  }

  map.setPaintProperty(`${sourceId}-fill`, "fill-opacity", [
    "case",
    [
      "==",
      [
        "coalesce",
        ["get", "shapeName"],
        ["get", "admin1Name"],
        ["get", "admin2Name"],
      ],
      resolvedName,
    ],
    0.65,
    0.12,
  ]);

  map.setFilter(`${sourceId}-focus-stroke`, [
    "==",
    [
      "coalesce",
      ["get", "shapeName"],
      ["get", "admin1Name"],
      ["get", "admin2Name"],
    ],
    resolvedName,
  ]);

  const feat = featuresByName[currentMode][resolvedName];
  if (feat && !skipCamera) {
    const bounds = getBounds(feat.geometry.coordinates);
    map.fitBounds(bounds, {
      padding: getResponsivePadding(),
      duration: 1100,
      essential: true,
    });
  }
}

function resetView() {
  const selectedName = document.getElementById("item-select").value;

  if (!selectedName || selectedName === "all") {
    const currentDefaults = getResponsiveDefaults();
    map.easeTo({
      center: currentDefaults.center,
      zoom: currentDefaults.zoom,
      pitch: 0,
      bearing: 0,
      duration: 900,
    });
    return;
  }

  const feat = featuresByName[currentMode][selectedName];
  if (feat) {
    const bounds = getBounds(feat.geometry.coordinates);
    map.fitBounds(bounds, {
      padding: getResponsivePadding(),
      pitch: 0,
      bearing: 0,
      duration: 900,
      essential: true,
    });
  }
}

// Adjust camera zoom dynamically on screen rotation / resize if on Overview
window.addEventListener("resize", () => {
  const selected = document.getElementById("item-select")?.value;
  if (selected === "all" || !selected) {
    const defaults = getResponsiveDefaults();
    map.easeTo({ zoom: defaults.zoom, duration: 300 });
  }
});

/* ============================ Game map glue ============================= */
/* Helpers consumed by js/game.js: highlight called/revealed regions and
   forward map clicks while a "click the region" round is running. */

let gameActive = false;
const gameMarks = {};
let gameLayersReady = false;

function extractFeatureName(props) {
  if (!props) return "";
  return props.shapeName || props.admin1Name || props.admin2Name || "";
}

function getFeatureNamesForMode(mode) {
  return Object.keys(featuresByName[mode] || {});
}

function initGameLayers() {
  if (gameLayersReady) return;
  // Don't gate on isStyleLoaded(): a large GeoJSON source can keep it false
  // for a while even though adding layers is safe. The style object just has
  // to exist.
  if (!map.style) return;

  try {
    if (!map.getSource("game-highlight")) {
      map.addSource("game-highlight", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    const stateColor = [
      "match",
      ["get", "_state"],
      "target",
      "#f59e0b",
      "correct",
      "#10b981",
      "wrong",
      "#ef4444",
      "#f59e0b",
    ];

    if (!map.getLayer("game-highlight-fill")) {
      map.addLayer({
        id: "game-highlight-fill",
        type: "fill",
        source: "game-highlight",
        paint: { "fill-color": stateColor, "fill-opacity": 0.55 },
      });
    }

    if (!map.getLayer("game-highlight-line")) {
      map.addLayer({
        id: "game-highlight-line",
        type: "line",
        source: "game-highlight",
        paint: { "line-color": stateColor, "line-width": 3, "line-opacity": 1 },
      });
    }

    gameLayersReady = true;
  } catch (e) {
    console.warn("[GeoLeban] Could not add game layers yet:", e && e.message);
  }
}

function refreshGameSource() {
  if (!gameLayersReady) initGameLayers();
  if (!gameLayersReady || !map.getSource("game-highlight")) return;
  const features = [];
  Object.keys(gameMarks).forEach((name) => {
    const feat = featuresByName[currentMode][name];
    if (!feat) return;
    features.push({
      type: "Feature",
      geometry: feat.geometry,
      properties: Object.assign({}, feat.properties, {
        _state: gameMarks[name],
      }),
    });
  });
  map.getSource("game-highlight").setData({
    type: "FeatureCollection",
    features,
  });
}

function gameMark(name, state) {
  if (!name) return;
  gameMarks[name] = state;
  refreshGameSource();
}

function gameClearMarks() {
  Object.keys(gameMarks).forEach((k) => delete gameMarks[k]);
  refreshGameSource();
}

// Clears only the "transient" marks (the current target and wrong guesses)
// while keeping correctly solved places green until the round is over, so the
// player can see which places they already got right.
function gameClearTransientMarks() {
  Object.keys(gameMarks).forEach((k) => {
    if (gameMarks[k] !== "correct") delete gameMarks[k];
  });
  refreshGameSource();
}

function setGameActive(on) {
  gameActive = on;
  document.body.classList.toggle("playing", on);
  if (on) {
    initGameLayers();
    setBaseFillDim(true);
    applyLabelVisibility(true);
  } else {
    gameClearMarks();
    setBaseFillDim(false);
    applyLabelVisibility(false);
  }
}

/* --------------------- Map labels (explore preference) ------------------ */

function applyLabelVisibility(forceHidden) {
  if (!mapLabelLayerIds.length) return;
  const vis = forceHidden || !labelsVisible ? "none" : "visible";
  mapLabelLayerIds.forEach((id) => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", vis);
    }
  });
}

function setMapLabels(visible) {
  labelsVisible = !!visible;
  applyLabelVisibility(false);
}

function getMapLabelsVisible() {
  return labelsVisible;
}

/* ------------------- Map painting (pick-on-map phase) ------------------- */

function setMapPainting(on) {
  if (on) {
    map.dragPan.disable();
    map.getCanvas().style.cursor = "default";
  } else {
    map.dragPan.enable();
    map.getCanvas().style.cursor = "";
  }
}

function setBaseFillDim(dim) {
  const sourceId = sourceIdForMode(currentMode);
  const layerId = `${sourceId}-fill`;
  if (map.getLayer(layerId)) {
    map.setPaintProperty(layerId, "fill-opacity", dim ? 0.16 : 0.38);
  }
}

/* --------------------- Discover: click a place -------------------------- */

let mapToastTimer = null;

function showMapToast(text) {
  const el = document.getElementById("map-toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  if (mapToastTimer) clearTimeout(mapToastTimer);
  mapToastTimer = setTimeout(() => el.classList.remove("show"), 5000);
}
window.showMapToast = showMapToast;

function handleDiscoverClick(e) {
  const layer = `${sourceIdForMode(currentMode)}-fill`;
  if (!map.getLayer(layer)) return;
  const feats = map.queryRenderedFeatures(e.point, { layers: [layer] });
  if (!feats || !feats.length) return;
  const name = extractFeatureName(feats[0].properties);
  if (!name) return;

  // Highlight the clicked place (focus overlay + fill emphasis) and reflect it
  // in the dropdown, without moving the camera.
  selectItem(name, { skipCamera: true });
  showMapToast(getTranslatedName(name, currentLang));
}

map.on("click", (e) => {
  if (gameActive) {
    if (typeof handleGameMapClick === "function") handleGameMapClick(e);
    return;
  }
  if (document.body.classList.contains("overlay-open")) return;
  if (typeof window.isSelectingOnMap === "function" && window.isSelectingOnMap()) {
    return;
  }
  handleDiscoverClick(e);
});

/* --------------------- Searchable place selector ------------------------ */

// Live suggestions under the search box, matched on the current language's
// labels only (Arabic mode searches Arabic names, and so on).
function renderSuggestions(term) {
  const box = document.getElementById("item-suggestions");
  if (!box) return;
  const q = (term || "").trim().toLowerCase();
  box.innerHTML = "";
  if (!q) {
    box.classList.remove("show");
    return;
  }
  const matches = placeOptions
    .filter((o) => o.label.toLowerCase().indexOf(q) !== -1)
    .slice(0, 8);
  if (!matches.length) {
    box.classList.remove("show");
    return;
  }
  matches.forEach((m) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggestion";
    btn.textContent = m.label;
    btn.addEventListener("click", () => {
      selectItem(m.raw);
      const search = document.getElementById("item-search");
      // Keep the full chosen name in the box instead of clearing it.
      if (search) search.value = m.label;
      renderSuggestions("");
      filterItemOptions("");
    });
    box.appendChild(btn);
  });
  box.classList.add("show");
}

function bindItemSearch() {
  const search = document.getElementById("item-search");
  const btn = document.getElementById("item-search-btn");
  const select = document.getElementById("item-select");
  if (!search) return;

  search.addEventListener("input", () => renderSuggestions(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      filterItemOptions(search.value);
      renderSuggestions("");
    }
  });
  if (btn) {
    btn.addEventListener("click", () => {
      filterItemOptions(search.value);
      renderSuggestions("");
      search.focus();
    });
  }
  if (select) {
    select.addEventListener("change", () => {
      const opt = select.options[select.selectedIndex];
      // Mirror the chosen place in the search box rather than clearing it.
      search.value = opt && opt.value !== "all" ? opt.textContent : "";
      renderSuggestions("");
      renderPlaceOptions("", select.value);
    });
  }
  // Dismiss suggestions when clicking outside the search box.
  document.addEventListener("click", (e) => {
    const box = document.getElementById("item-suggestions");
    if (!box) return;
    if (e.target === search || box.contains(e.target)) return;
    renderSuggestions("");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindItemSearch);
} else {
  bindItemSearch();
}
