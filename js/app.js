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

  // Initialize with the whole map overview
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

  // Reset dropdown and view back to whole country
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
    // Restore default opacity to all polygons and remove border focus ring
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
      center: MAP_DEFAULTS.center,
      zoom: MAP_DEFAULTS.zoom,
      pitch: 0,
      bearing: 0,
      duration: 1100,
    });
    return;
  }

  // Dim background polygons and spotlight selected polygon
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
      padding: { top: 110, bottom: 80, left: 80, right: 80 },
      duration: 1100,
      essential: true,
    });
  }
}

function resetView() {
  const selectedName = document.getElementById("item-select").value;

  if (!selectedName || selectedName === "all") {
    map.easeTo({
      center: MAP_DEFAULTS.center,
      zoom: MAP_DEFAULTS.zoom,
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
      padding: { top: 110, bottom: 80, left: 80, right: 80 },
      pitch: 0,
      bearing: 0,
      duration: 900,
      essential: true,
    });
  }
}
