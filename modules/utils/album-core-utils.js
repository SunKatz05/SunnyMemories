import {
  ALBUM_DIARY_MAX_WORDS,
  ALBUM_FOLDER_SORT_VALUES,
  ALBUM_SORT_VALUES,
} from "../constants.js";

export function sanitizeAlbumFileNamePart(raw, fallback = "image") {
  const normalized = String(raw || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\.\-]+|[_\.\-]+$/g, "");
  return normalized || fallback;
}

export function filterUndefinedFields(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export function getAlbumPromptTextFromGenerationMeta(generationMeta) {
  if (!generationMeta || typeof generationMeta !== "object") return "";

  const directKeys = ["prompt", "instruction", "positive_prompt", "text", "style"];
  for (const key of directKeys) {
    const value = String(generationMeta?.[key] || "").trim();
    if (value) return value;
  }

  const nestedPrompt = String(
    generationMeta?.params?.prompt ||
      generationMeta?.generation?.prompt ||
      generationMeta?.meta?.prompt ||
      "",
  ).trim();
  return nestedPrompt;
}

export function getAlbumStyleTextFromGenerationMeta(generationMeta) {
  if (!generationMeta || typeof generationMeta !== "object") return "";

  const directKeys = ["style", "art_style", "visual_style"];
  for (const key of directKeys) {
    const value = String(generationMeta?.[key] || "").trim();
    if (value) return value;
  }

  return String(generationMeta?.params?.style || generationMeta?.meta?.style || "").trim();
}

export function parseAlbumGenerationMeta(raw) {
  const source = String(raw || "").trim();
  if (!source) return null;

  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

export function normalizeLibraryView(view) {
  return String(view || "").toLowerCase() === "facts" ? "facts" : "summary";
}

export function normalizeAlbumSort(sort) {
  const normalized = String(sort || "").toLowerCase();
  return ALBUM_SORT_VALUES.has(normalized) ? normalized : "date_desc";
}

export function normalizeAlbumFolderSort(sort) {
  const normalized = String(sort || "").toLowerCase();
  return ALBUM_FOLDER_SORT_VALUES.has(normalized) ? normalized : "name_asc";
}

export function makeAlbumId(prefix = "alb") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

export function getImageNameFromUrl(url, fallback = "image") {
  const source = String(url || "");
  if (!source) return fallback;

  try {
    const clean = source.split("?")[0].split("#")[0];
    const fileName = clean.split("/").pop() || "";
    const decoded = decodeURIComponent(fileName).trim();
    return decoded || fallback;
  } catch (_err) {
    const clean = source.split("?")[0].split("#")[0];
    const fileName = clean.split("/").pop() || "";
    return fileName.trim() || fallback;
  }
}

export function trimToWordLimit(text, maxWords = ALBUM_DIARY_MAX_WORDS) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}
