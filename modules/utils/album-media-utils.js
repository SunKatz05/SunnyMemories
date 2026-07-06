import { sanitizeAlbumFileNamePart, getImageNameFromUrl } from "./album-core-utils.js";

export function getExtensionFromUrl(url, fallback = "jpg") {
  try {
    const parsed = new URL(String(url || ""), window.location.origin);
    const pathname = String(parsed.pathname || "");
    const ext = pathname.split(".").pop() || "";
    const safeExt = String(ext).trim().toLowerCase();
    if (/^[a-z0-9]{2,6}$/.test(safeExt)) return safeExt;
  } catch (_error) {}
  return fallback;
}

export function buildAlbumRemoteFileName(url) {
  const baseName = sanitizeAlbumFileNamePart(getImageNameFromUrl(url, "image"), "image");
  const hasExt = /\.[a-zA-Z0-9]{2,6}$/.test(baseName);
  const ext = getExtensionFromUrl(url, "jpg");
  const timestamp = Date.now();
  const randomPart = Math.floor(Math.random() * 1000000);

  const rawBase = hasExt ? baseName.replace(/\.[a-zA-Z0-9]{2,6}$/g, "") : baseName;
  const finalBase = sanitizeAlbumFileNamePart(rawBase, "image").slice(0, 64);
  return `${finalBase}_${timestamp}_${randomPart}.${ext}`;
}

export function isSupportedRemoteImageUrl(url) {
  try {
    const parsed = new URL(String(url || ""), window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

export function resolveImageFetchUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("blob:") || raw.startsWith("data:image/")) {
    return raw;
  }

  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

export function getExtensionFromMimeType(mimeType, fallback = "") {
  const normalizedMime = String(mimeType || "").toLowerCase().trim();
  if (!normalizedMime) return fallback;
  if (normalizedMime.includes("jpeg")) return "jpg";
  if (normalizedMime.includes("png")) return "png";
  if (normalizedMime.includes("webp")) return "webp";
  if (normalizedMime.includes("gif")) return "gif";
  if (normalizedMime.includes("bmp")) return "bmp";
  if (normalizedMime.includes("avif")) return "avif";
  return fallback;
}

export function getImageExtensionForBlob(blob, sourceUrl) {
  const byMime = getExtensionFromMimeType(blob?.type, "");
  if (byMime) return byMime;
  return getExtensionFromUrl(sourceUrl, "jpg");
}

export function normalizeAlbumStoredPath(path) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (/^(?:https?:|data:|blob:)/i.test(value)) return value;
  return value.startsWith("/") ? value : `/${value}`;
}

export function buildAlbumDownloadFileName(imageNameHint, sourceUrl = "", mimeType = "") {
  const nameHint =
    String(imageNameHint || "").trim() || String(getImageNameFromUrl(sourceUrl, "image") || "").trim();
  const safeName = sanitizeAlbumFileNamePart(nameHint, "image");
  if (/\.[a-zA-Z0-9]{2,6}$/.test(safeName)) {
    return safeName;
  }

  const extension = getExtensionFromMimeType(mimeType, getExtensionFromUrl(sourceUrl, "jpg"));
  return `${safeName}.${extension || "jpg"}`;
}
