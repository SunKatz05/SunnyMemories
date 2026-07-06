import { getContext } from "../../../../../extensions.js";

export function getMessageId(message) {
  return /** @type {any} */ (message)?.id ?? null;
}

export function isMessageHidden(message) {
  return Boolean(/** @type {any} */ (message)?.is_hidden);
}

export function isMessageSystem(message) {
  return Boolean(/** @type {any} */ (message)?.is_system);
}

export function cleanMessage(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.innerHTML = text;
  return div.textContent || "";
}

export function getVisibleChatRange(fromMessageId = 0, toMessageId = null) {
  const ctx = getContext();
  if (!ctx?.chat?.length) return [];

  const startIdx = Math.max(0, Number.isFinite(fromMessageId) ? fromMessageId : 0);
  const endIdx =
    toMessageId === null || toMessageId === undefined
      ? ctx.chat.length - 1
      : Math.min(ctx.chat.length - 1, Math.max(0, toMessageId));

  if (endIdx < startIdx) return [];

  return ctx.chat
    .slice(startIdx, endIdx + 1)
    .filter((m) => {
      if (!m || typeof m.mes !== "string") return false;
      if (isMessageHidden(m)) return false;
      if (isMessageSystem(m)) return false;
      if (m.extra?.type === "system") return false;
      return true;
    });
}
