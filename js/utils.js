/**
 * Resolves a given raw feature name to localized string based on language.
 */
function getTranslatedName(rawName, currentLang) {
  if (TRANSLATIONS.names[rawName] && TRANSLATIONS.names[rawName][currentLang]) {
    return TRANSLATIONS.names[rawName][currentLang];
  }

  const normalized = rawName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(el-|al-)/i, "");

  for (const [key, map] of Object.entries(TRANSLATIONS.names)) {
    const normKey = key
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/^(el-|al-)/i, "");

    if (normKey.toLowerCase() === normalized.toLowerCase()) {
      return map[currentLang] || rawName;
    }
  }

  return rawName;
}

/**
 * Traverses GeoJSON coordinates recursively to compute standard bounding box: [[minLng, minLat], [maxLng, maxLat]].
 */
function getBounds(coords) {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < minLng) minLng = c[0];
      if (c[0] > maxLng) maxLng = c[0];
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
    } else {
      c.forEach(walk);
    }
  };
  walk(coords);
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
