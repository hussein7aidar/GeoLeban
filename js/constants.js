const DEFAULT_SELECTION = "all";

const PALETTE = [
  "#f97316",
  "#06b6d4",
  "#8b5cf6",
  "#10b981",
  "#ec4899",
  "#f59e0b",
  "#3b82f6",
  "#14b8a6",
  "#84cc16",
  "#a855f7",
  "#e11d48",
  "#6366f1",
];

function getResponsiveDefaults() {
  const isMobile = window.innerWidth <= 600;
  return {
    center: [35.86, 33.88],
    zoom: isMobile ? 7.2 : 7.9,
    pitch: 0,
    bearing: 0,
    maxPitch: 65,
    style: "https://tiles.openfreemap.org/styles/positron",
  };
}

const MAP_DEFAULTS = getResponsiveDefaults();
