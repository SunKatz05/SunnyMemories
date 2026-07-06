import { isMessageHidden, isMessageSystem } from "./chat-utils.js";
import { normalizeNumber } from "./common-utils.js";

export function isPriorityDateSourceMessage(message) {
  if (!message || isMessageHidden(message) || isMessageSystem(message)) return false;
  if (message.extra?.type === "system") return false;
  return message.is_user !== true;
}

export function getTailMessagesForDateSync(chat, limit = 2) {
  if (!Array.isArray(chat) || chat.length === 0) return [];
  const safeLimit = Math.max(1, normalizeNumber(limit, 2));
  return chat.slice(-safeLimit);
}
