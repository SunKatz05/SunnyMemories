import { getMessageId, getVisibleChatRange, cleanMessage } from "./chat-utils.js";
import { normalizeNumber } from "./common-utils.js";
import {
  extractDateFromText,
  isLikelyDateText,
  monthNameFromToken,
} from "./date-parse-utils.js";
import {
  getTailMessagesForDateSync,
  isPriorityDateSourceMessage,
} from "./calendar-chat-utils.js";

export function normalizeCalendarSignal(signal, calData = null, options = {}) {
  if (!signal || typeof signal !== "object") return null;

  const fallbackCalendar = options?.fallbackCalendar || null;
  const fallbackMonths = Array.isArray(options?.fallbackMonths)
    ? options.fallbackMonths
    : [];
  const resolvedCalData = calData || fallbackCalendar || {};

  const mode = String(signal.mode || "").trim().toLowerCase();
  const source = String(signal.source || "metadata").trim() || "metadata";
  const rawText = String(signal.rawText || "").trim();
  const sourceMessageId =
    signal.sourceMessageId === undefined ||
    signal.sourceMessageId === null ||
    signal.sourceMessageId === ""
      ? null
      : signal.sourceMessageId;

  const confidenceNum = Number(signal.confidence);
  const confidence = Number.isFinite(confidenceNum) ? confidenceNum : 0;

  if (mode === "setdate" || mode === "set_date") {
    const day = normalizeNumber(signal.day, 0);
    const month = monthNameFromToken(signal.month, resolvedCalData, fallbackMonths);
    const year = normalizeNumber(signal.year, 0);

    const monthEntry = (resolvedCalData?.months || fallbackMonths).find(
      (entry) => entry.name === month,
    );
    const monthDays = normalizeNumber(monthEntry?.days, 31);

    if (!day || !month || !year) return null;
    if (day < 1 || day > monthDays || year <= 0) return null;

    return {
      mode: "setDate",
      day,
      month,
      year,
      source,
      rawText,
      sourceMessageId,
      confidence,
    };
  }

  if (mode === "advance") {
    const days = normalizeNumber(signal.days, 0);
    if (days <= 0) return null;

    return {
      mode: "advance",
      days,
      source,
      rawText,
      sourceMessageId,
      confidence,
    };
  }

  return null;
}

export function getLatestCalendarSignal(toMessageId = null, calData = null, options = {}) {
  const chat = getVisibleChatRange(0, toMessageId);

  const tailMessages = getTailMessagesForDateSync(chat, 2);
  if (tailMessages.length === 0) return null;

  const candidates = [];
  for (let i = tailMessages.length - 1; i >= 0; i--) {
    const message = tailMessages[i];
    const sig = normalizeCalendarSignal(
      message?.extra?.sunny_memories?.calendarSignal,
      calData,
      options,
    );

    if (!sig) continue;

    candidates.push({
      sig,
      message,
      tailIndexFromEnd: tailMessages.length - 1 - i,
      priority: isPriorityDateSourceMessage(message) ? 2 : 1,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.tailIndexFromEnd - b.tailIndexFromEnd;
  });

  const picked = candidates[0];
  return {
    ...picked.sig,
    sourceMessageId:
      getMessageId(picked.message) ?? picked.sig.sourceMessageId ?? picked.tailIndexFromEnd,
  };
}

export function bootstrapCalendarSignalFromMessage(message, calData, options = {}) {
  if (!message || typeof message.mes !== "string") return null;

  const fallbackMonths = Array.isArray(options?.fallbackMonths)
    ? options.fallbackMonths
    : [];

  const rawText = cleanMessage(message.mes);
  if (!rawText.trim()) return null;
  if (!isLikelyDateText(rawText)) return null;

  const found = extractDateFromText(rawText, calData, { fallbackMonths });
  if (!found) return null;

  return normalizeCalendarSignal(
    {
      mode: "setDate",
      day: found.day,
      month: found.month,
      year: found.year,
      source: "ai-bootstrap",
      rawText,
      sourceMessageId: getMessageId(message),
      confidence: 0.8,
    },
    calData,
    options,
  );
}
