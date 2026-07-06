import {
  eventSource,
  event_types,
  getMaxContextSize,
} from "../../../../../../script.js";
import { extension_settings, getContext } from "../../../../../extensions.js";
import { cleanMessage } from "./chat-utils.js";

const $ = /** @type {any} */ ((/** @type {any} */ (globalThis)).$);

const extensionName = "SunnyMemories";

function t(key) {
  const translate = /** @type {any} */ (globalThis)?.t;
  if (typeof translate === "function") return translate(key);
  return String(key || "");
}

export function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeAttr(text) {
  return escapeHtml(text)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function highlightSearchMatch(text, query) {
  const raw = String(text || "");
  const q = String(query || "").trim().toLowerCase();
  if (!raw) return "";
  if (!q) return escapeHtml(raw);

  const lower = raw.toLowerCase();
  let cursor = 0;
  let out = "";

  while (cursor < raw.length) {
    const hitIndex = lower.indexOf(q, cursor);
    if (hitIndex === -1) {
      out += escapeHtml(raw.slice(cursor));
      break;
    }

    out += escapeHtml(raw.slice(cursor, hitIndex));
    out += `<span class="sm-search-hit">${escapeHtml(raw.slice(hitIndex, hitIndex + q.length))}</span>`;
    cursor = hitIndex + q.length;
  }

  return out;
}

export function compressQuestNotes(notes, maxChunks = 3) {
  const raw = cleanMessage(String(notes || "")).replace(/\s+/g, " ").trim();
  if (!raw) return "";

  const filler = /\b(?:very|really|just|maybe|probably|kind of|sort of|actually|literally|that|this|there|here|and|or|the|a|an|to|of|in|on|for|with|from|at|by|is|are|was|were|be|been|being)\b/gi;

  const chunks = raw
    .split(/(?:[•\n]|[,;]|(?<=[.!?])\s+)/)
    .map((s) => s.replace(filler, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();

  for (const c of chunks) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= maxChunks) break;
  }

  return out.join(" | ");
}

export function getContextSize() {
  if (typeof getMaxContextSize === "function") return getMaxContextSize();
  return (/** @type {any} */ (getContext() || {})).settings?.context_size || 4096;
}

export async function switchProfile(profileName) {
  const cm = extension_settings?.connectionManager;
  if (!cm || !cm.profiles) return;

  const profilesSelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("connection_profiles")
  );
  if (!profilesSelect) return;

  let targetId = "";
  if (profileName) {
    const profile = cm.profiles.find((p) => p.name === profileName);
    if (profile) targetId = profile.id;
  }

  const awaitPromise = new Promise((resolve) => {
    const onLoaded = () => {
      eventSource.removeListener(
        event_types.CONNECTION_PROFILE_LOADED,
        onLoaded,
      );
      resolve();
    };
    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, onLoaded);

    setTimeout(() => {
      eventSource.removeListener(
        event_types.CONNECTION_PROFILE_LOADED,
        onLoaded,
      );
      resolve();
    }, 5000);
  });

  profilesSelect.value = targetId;
  profilesSelect.dispatchEvent(new Event("change"));

  await awaitPromise;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

export function updateProfilesList() {
  const select = $("#sunny-memories-profile");
  if (!select.length) return;

  const savedProfileId = getExtensionProfileId();

  select.empty().append(`<option value="">${t("same_as_current")}</option>`);

  try {
    const cm = extension_settings?.connectionManager;
    if (cm && cm.profiles) {
      cm.profiles.forEach((p) => {
        select.append($("<option></option>").val(p.id).text(p.name));
      });
    }
  } catch (_e) {}

  select.val(savedProfileId);
}

export function getCurrentProfileName() {
  try {
    const cm = extension_settings?.connectionManager;
    if (!cm || !cm.selectedProfile) return "";
    const profile = cm.profiles?.find((p) => p.id === cm.selectedProfile);
    return profile ? profile.name : "";
  } catch (_e) {
    return "";
  }
}

export function getExtensionProfileId() {
  return extension_settings[extensionName]?.connectionProfileId || "";
}

export function setExtensionProfileId(profileId) {
  if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = {};
  }
  extension_settings[extensionName].connectionProfileId = profileId || "";
}

export function getExtensionProfileName() {
  const id = getExtensionProfileId();
  const profile = extension_settings?.connectionManager?.profiles?.find(
    (p) => p.id === id,
  );
  return profile?.name || "";
}
