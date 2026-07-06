function isNonEmptyValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function getMessageRoleKey(message) {
  if (!message || typeof message !== "object") return "unknown";

  const explicitRole = message.role ?? message.extra?.role ?? message.type ?? message.extra?.type;
  if (isNonEmptyValue(explicitRole)) return String(explicitRole).trim();
  if (message.is_system === true || message.extra?.is_system === true) return "system";
  if (message.is_user === true) return "user";
  if (message.is_user === false) return "character";
  return "unknown";
}

function getMessageDateKey(message) {
  if (!message || typeof message !== "object") return "undated";

  const rawDate = message.send_date
    ?? message.sendDate
    ?? message.date
    ?? message.timestamp
    ?? message.createdAt
    ?? message.created_at
    ?? message.extra?.send_date
    ?? message.extra?.timestamp
    ?? message.extra?.createdAt
    ?? message.extra?.created_at;

  return isNonEmptyValue(rawDate) ? String(rawDate).trim() : "undated";
}

function getSafeMessageKey(message, index, getMessageId) {
  const id = typeof getMessageId === "function" ? getMessageId(message) : null;
  if (isNonEmptyValue(id)) return String(id);

  return `idx:${index}:${hashChatScopeParts([
    "fallback-v2",
    index,
    getMessageRoleKey(message),
    getMessageDateKey(message),
  ])}`;
}

function hashChatScopeParts(parts) {
  const text = (Array.isArray(parts) ? parts : []).join("\u001f");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`;
}

export function getSunnyChatScopeAnchors(ctx, getMessageId) {
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  const messageIds = new Set();
  const messageKeys = [];
  const prefixSignatures = [];

  chat.forEach((message, index) => {
    messageIds.add(String(index));
    const id = typeof getMessageId === "function" ? getMessageId(message) : null;
    if (id !== undefined && id !== null && String(id).trim() !== "") {
      messageIds.add(String(id));
    }

    messageKeys.push(getSafeMessageKey(message, index, getMessageId));
    prefixSignatures[index] = hashChatScopeParts(messageKeys.slice(0, index + 1));
  });

  return {
    maxIndex: chat.length - 1,
    messageIds,
    messageKeys,
    prefixSignatures,
  };
}

function resolveChatScopeIndex(ctx, getMessageId, upToMessageId = null) {
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  if (!chat.length) return -1;

  if (isNonEmptyValue(upToMessageId)) {
    const anchor = String(upToMessageId).trim();
    const idIndex = chat.findIndex((message) => {
      const id = typeof getMessageId === "function" ? getMessageId(message) : null;
      return isNonEmptyValue(id) && String(id) === anchor;
    });
    if (idIndex >= 0) return idIndex;

    const requestedIndex = Number(upToMessageId);
    if (Number.isFinite(requestedIndex)) {
      const index = Math.trunc(requestedIndex);
      if (index < 0) return 0;
      return index <= chat.length - 1 ? index : -1;
    }

    return -1;
  }

  return chat.length - 1;
}

export function getSunnyChatScopeMeta(ctx, getMessageId, upToMessageId = null) {
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  if (!chat.length) return null;

  const index = resolveChatScopeIndex(ctx, getMessageId, upToMessageId);
  if (index < 0 || index > chat.length - 1) return null;
  const messageKeys = [];

  for (let i = 0; i <= index; i++) {
    messageKeys.push(getSafeMessageKey(chat[i], i, getMessageId));
  }

  const lastMessageId = typeof getMessageId === "function" ? getMessageId(chat[index]) : null;
  return {
    version: 1,
    messageIndex: index,
    lastMessageId: lastMessageId !== undefined && lastMessageId !== null && String(lastMessageId).trim() !== ""
      ? String(lastMessageId)
      : String(index),
    signature: hashChatScopeParts(messageKeys),
    size: messageKeys.length,
    createdAt: Date.now(),
  };
}

function normalizeScope(scope) {
  if (!scope || typeof scope !== "object") return null;
  return scope;
}

function getItemScope(item) {
  if (!item || typeof item !== "object") return null;
  return normalizeScope(item._sunnyChatScope || item.chatScope || item.scope);
}

function isNonEmptyAnchor(value) {
  return isNonEmptyValue(value);
}

function isIndexLikeAnchor(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}

export function stampSunnyChatScope(item, ctx, getMessageId, upToMessageId = null) {
  if (!item || typeof item !== "object") return item;
  if (normalizeScope(item._sunnyChatScope || item.chatScope)) return item;

  const scope = getSunnyChatScopeMeta(ctx, getMessageId, upToMessageId);
  if (scope) item._sunnyChatScope = scope;
  return item;
}

export function stampSunnyChatScopeList(items, ctx, getMessageId, getItemMessageIndex = null) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    if (normalizeScope(item._sunnyChatScope || item.chatScope)) return item;

    const rawAnchor = typeof getItemMessageIndex === "function" ? getItemMessageIndex(item) : null;
    const hasExplicitAnchor = isNonEmptyValue(rawAnchor);
    if (hasExplicitAnchor && resolveChatScopeIndex(ctx, getMessageId, rawAnchor) < 0) return item;

    return stampSunnyChatScope(item, ctx, getMessageId, hasExplicitAnchor ? rawAnchor : null);
  });
}

export function isSunnyChatScopedItemInCurrentChat(item, chatAnchors, options = {}) {
  if (!item || typeof item !== "object") return true;

  const scope = getItemScope(item);
  if (scope) {
    const scopeIndex = Number(scope.messageIndex ?? scope.lastMessageIndex ?? scope.createdAtIndex);
    if (Number.isFinite(scopeIndex)) {
      if (scopeIndex > chatAnchors.maxIndex) return false;
      if (isNonEmptyAnchor(scope.signature) && Array.isArray(chatAnchors.prefixSignatures)) {
        return chatAnchors.prefixSignatures[scopeIndex] === String(scope.signature);
      }
    }

    const scopeMessageId = scope.lastMessageId ?? scope.sourceMessageId ?? scope.messageId;
    if (isNonEmptyAnchor(scopeMessageId)) {
      if (chatAnchors.messageIds?.size === 0) return true;
      if (chatAnchors.messageIds?.has(String(scopeMessageId))) return true;
      if (isIndexLikeAnchor(scopeMessageId)) {
        return Number(scopeMessageId) <= chatAnchors.maxIndex;
      }
      return false;
    }
  }

  const idKeys = Array.isArray(options.idKeys) ? options.idKeys : [];
  for (const key of idKeys) {
    const value = item[key];
    if (!isNonEmptyAnchor(value)) continue;
    if (chatAnchors.messageIds?.size === 0) return true;
    if (chatAnchors.messageIds?.has(String(value))) return true;
    if (isIndexLikeAnchor(value)) {
      const padding = Number(options.legacyIndexPadding || 0);
      return Number(value) <= chatAnchors.maxIndex + padding;
    }
    return false;
  }

  const countIndexKeys = Array.isArray(options.countIndexKeys) ? options.countIndexKeys : [];
  for (const key of countIndexKeys) {
    const value = Number(item[key]);
    if (Number.isFinite(value)) return value <= chatAnchors.maxIndex + 1;
  }

  const indexKeys = Array.isArray(options.indexKeys) ? options.indexKeys : [];
  for (const key of indexKeys) {
    const value = Number(item[key]);
    if (Number.isFinite(value)) return value <= chatAnchors.maxIndex;
  }

  return true;
}
