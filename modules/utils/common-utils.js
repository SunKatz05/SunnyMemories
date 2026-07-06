export function normInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeNumber(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeHexColor(value, fallback = "#000000") {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return (
      "#" +
      raw
        .slice(1)
        .split("")
        .map((ch) => ch + ch)
        .join("")
        .toLowerCase()
    );
  }
  return fallback;
}

export function hexColorToRgbString(hexColor, fallback = "125, 211, 252") {
  const normalized = normalizeHexColor(hexColor, "");
  if (!normalized || normalized.length !== 7) return fallback;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  if (![r, g, b].every(Number.isFinite)) return fallback;
  return `${r}, ${g}, ${b}`;
}

export function normalizeToggleFlag(value, fallback = false) {
  if (value === true || value === false) return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  }
  return fallback;
}
