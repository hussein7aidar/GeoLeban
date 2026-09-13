let currentTheme = "light";
let currentMode = "gov";
let currentLang = "ar";
const featuresByName = { gov: {}, caza: {} };

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
    }
  });

  if (typeof LEBANON_DATA !== "undefined")
    setupDataset("gov", "lebanon-govs", LEBANON_DATA);
  if (typeof CAZAS_DATA !== "undefined")
    setupDataset("caza", "lebanon-cazas", CAZAS_DATA);

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
  const fillMatch = [
    "match",
    [
      "coalesce",
      ["get", "shapeName"],
      ["get", "admin1Name"],
      ["get", "admin2Name"],
    ],
  ];
  const strokeMatch = [
    "match",
    [
      "coalesce",
      ["get", "shapeName"],
      ["get", "admin1Name"],
      ["get", "admin2Name"],
    ],
  ];

  dataset.features.forEach((feat, idx) => {
    const name =
      feat.properties.shapeName ||
      feat.properties.admin1Name ||
      feat.properties.admin2Name;
    featuresByName[modeKey][name] = feat;

    const color = PALETTE[idx % PALETTE.length];
    fillMatch.push(name, color);
    strokeMatch.push(name, color);
  });

  fillMatch.push("#64748b");
  strokeMatch.push("#334155");

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
      "line-width": modeKey === "gov" ? 2.2 : 1.6,
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
}

function updateUiText() {
  const t = TRANSLATIONS.ui[currentLang];

  document.getElementById("btn-gov").textContent = t.gov;
  document.getElementById("btn-caza").textContent = t.caza;
  document.getElementById("btn-reset").title = t.resetTip;

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

function setMode(mode) {
  if (mode === "caza" && typeof CAZAS_DATA === "undefined") {
    alert("cazas.js was not found in the same folder.");
    return;
  }

  currentMode = mode;
  document.getElementById("btn-gov").classList.toggle("active", mode === "gov");
  document
    .getElementById("btn-caza")
    .classList.toggle("active", mode === "caza");

  updateLayerVisibilities();

  populateDropdown(DEFAULT_SELECTION);
  selectItem(DEFAULT_SELECTION);
}

function populateDropdown(targetValue = "all") {
  const select = document.getElementById("item-select");
  const t = TRANSLATIONS.ui[currentLang];

  select.innerHTML = `<option value="all">${t.overview}</option>`;

  const items = Object.keys(featuresByName[currentMode]);
  const sorted = items
    .map((rawName) => ({
      raw: rawName,
      display: getTranslatedName(rawName, currentLang),
    }))
    .sort((a, b) => a.display.localeCompare(b.display, currentLang));

  sorted.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.raw;
    opt.textContent = item.display;
    select.appendChild(opt);
  });

  const validKey = resolveFeatureKey(currentMode, targetValue);
  select.value = validKey;
}

function updateLayerVisibilities() {
  const showGov = currentMode === "gov" ? "visible" : "none";
  const showCaza = currentMode === "caza" ? "visible" : "none";

  ["fill", "stroke", "focus-stroke"].forEach((type) => {
    if (map.getLayer(`lebanon-govs-${type}`))
      map.setLayoutProperty(`lebanon-govs-${type}`, "visibility", showGov);
    if (map.getLayer(`lebanon-cazas-${type}`))
      map.setLayoutProperty(`lebanon-cazas-${type}`, "visibility", showCaza);
  });
}

function selectItem(name) {
  const resolvedName = resolveFeatureKey(currentMode, name);
  const select = document.getElementById("item-select");

  if (select && select.value !== resolvedName) {
    select.value = resolvedName;
  }

  const sourceId = currentMode === "gov" ? "lebanon-govs" : "lebanon-cazas";
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
    map.flyTo({
      center: currentDefaults.center,
      zoom: currentDefaults.zoom,
      pitch: 0,
      bearing: 0,
      duration: 1100,
    });
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
  if (feat) {
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
  if (!map.isStyleLoaded()) return;

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

function setGameActive(on) {
  gameActive = on;
  document.body.classList.toggle("playing", on);
  if (on) {
    initGameLayers();
    setBaseFillDim(true);
  } else {
    gameClearMarks();
    setBaseFillDim(false);
  }
}

function setBaseFillDim(dim) {
  const sourceId = currentMode === "gov" ? "lebanon-govs" : "lebanon-cazas";
  const layerId = `${sourceId}-fill`;
  if (map.getLayer(layerId)) {
    map.setPaintProperty(layerId, "fill-opacity", dim ? 0.16 : 0.38);
  }
}

map.on("click", (e) => {
  if (!gameActive) return;
  if (typeof handleGameMapClick === "function") handleGameMapClick(e);
});
