import { getSunnyChatScopeMeta } from "./utils/chat-scope-utils.js";

export const SUMMARY_MODE_DYNAMIC = "dynamic";
export const SUMMARY_MODE_STATIC = "static";

export const INTERNAL_SUMMARY_PROMPTS = {
  [SUMMARY_MODE_DYNAMIC]:
    "You are an AI story editor. Maintain a single evolving summary. Rewrite the summary as a compact canonical version. Keep only important stable facts. Compress repeated or obsolete details. Do not preserve old wording if a shorter wording can represent the same fact. Preserve continuity and important lore. Output only the summary text.",
  [SUMMARY_MODE_STATIC]:
    "You are an AI story editor. Create an append-only summary entry for this generation. Do not rewrite previous entries; keep history intact. Output only the summary text.",
};

export const DEFAULT_SUMMARY_PROMPT =
  "Write a short dry summary of all events so far. Maintain a detailed chronological flow. Each new update start with [Date]. Describe events in no longer than 150 words.";

function localCanonicalizeSignatureText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function localBuildContextInjectionSignature(parts = []) {
  return parts
    .map((part) => {
      if (part === null || part === undefined) return "";
      return String(part).trim();
    })
    .join("|");
}

export function createSummaryEngine({
  $,
  extension_settings,
  extensionName,
  getScopedFieldValue,
  getChatMemory,
  setChatMemory,
  getContext,
  getAbsoluteChatLength,
  getMessageId,
  normInt,
  buildContextInjectionSignature = localBuildContextInjectionSignature,
  canonicalizeSignatureText = localCanonicalizeSignatureText,
} = {}) {
  function normalizeSummaryMode(mode) {
    return String(mode || "").trim() === SUMMARY_MODE_STATIC
      ? SUMMARY_MODE_STATIC
      : SUMMARY_MODE_DYNAMIC;
  }

  function normalizeSummaryPromptSharing(value) {
    if (value === undefined || value === null) return true;
    if (value === true || value === false) return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["0", "false", "no", "off"].includes(normalized)) return false;
      if (["1", "true", "yes", "on", ""].includes(normalized)) return true;
    }
    return true;
  }

  function getRawSummaryPromptForMode(mode, settings = {}) {
    const normalizedMode = normalizeSummaryMode(mode);

    if (normalizeSummaryPromptSharing(settings.summaryUseSharedPrompt)) {
      return String(
        settings.summaryPromptShared ||
          settings.summaryPrompt ||
          DEFAULT_SUMMARY_PROMPT,
      );
    }

    const modePrompt =
      normalizedMode === SUMMARY_MODE_STATIC
        ? settings.summaryPromptStatic
        : settings.summaryPromptDynamic;

    return String(
      modePrompt ||
        settings.summaryPromptShared ||
        settings.summaryPrompt ||
        DEFAULT_SUMMARY_PROMPT,
    );
  }

  function ensureSummaryPromptSettings(settings = null) {
    const s =
      settings ||
      (extension_settings && extensionName
        ? (extension_settings[extensionName] ||= {})
        : {});

    if (typeof s.summaryPrompt !== "string" || !s.summaryPrompt.trim()) {
      s.summaryPrompt = DEFAULT_SUMMARY_PROMPT;
    }

    s.summaryMode = normalizeSummaryMode(s.summaryMode);
    s.summaryUseSharedPrompt = normalizeSummaryPromptSharing(
      s.summaryUseSharedPrompt,
    );

    if (typeof s.summaryPromptShared !== "string" || !s.summaryPromptShared.trim()) {
      s.summaryPromptShared = s.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
    }
    if (typeof s.summaryPromptDynamic !== "string") s.summaryPromptDynamic = "";
    if (typeof s.summaryPromptStatic !== "string") s.summaryPromptStatic = "";

    if (s.summaryUseSharedPrompt) {
      s.summaryPrompt = s.summaryPromptShared || DEFAULT_SUMMARY_PROMPT;
    } else {
      s.summaryPrompt = getRawSummaryPromptForMode(s.summaryMode, s);
    }

    return s;
  }

  function getSummaryPromptForMode(mode, settings = null) {
    const s = ensureSummaryPromptSettings(settings);
    return getRawSummaryPromptForMode(mode, s);
  }

  function persistSummaryPromptFieldValue(mode, useSharedPrompt = null) {
    const s = ensureSummaryPromptSettings();
    const promptValue = String(
      typeof getScopedFieldValue === "function"
        ? getScopedFieldValue(
            "#sunny-memories-prompt-summary",
            getSummaryPromptForMode(mode, s),
          )
        : $("#sunny-memories-prompt-summary").val(),
    );

    const useShared =
      useSharedPrompt === null || useSharedPrompt === undefined
        ? normalizeSummaryPromptSharing(s.summaryUseSharedPrompt)
        : normalizeSummaryPromptSharing(useSharedPrompt);

    if (useShared) {
      s.summaryPromptShared = promptValue;
    } else if (normalizeSummaryMode(mode) === SUMMARY_MODE_STATIC) {
      s.summaryPromptStatic = promptValue;
    } else {
      s.summaryPromptDynamic = promptValue;
    }

    s.summaryPrompt = promptValue || DEFAULT_SUMMARY_PROMPT;
    return s;
  }

  function getSummaryModePrompt(mode) {
    return INTERNAL_SUMMARY_PROMPTS[normalizeSummaryMode(mode)];
  }

  function buildSummaryAdditionalRequestBlock(currentPrompt) {
    const promptText = String(currentPrompt || "").trim() || DEFAULT_SUMMARY_PROMPT;
    return `USER SUMMARY REQUEST:\n${promptText}`;
  }

  function getSummaryStaticKeepLatestSetting(settings = null) {
    const s = settings || {};
    return Math.max(1, normInt(s.summaryStaticKeepLatest, 1));
  }

  function getSummaryStaticMaxEntriesSetting(settings = null) {
    const s = settings || {};
    return Math.max(1, normInt(s.summaryStaticMaxEntries, 30));
  }

  function normalizeStaticSummaryEntrySource(source = {}) {
    const text = String(source?.text || source?.content || "").trim();
    if (!text) return null;

    const sourceMessages = Math.max(0, normInt(source?.sourceMessages, 0));
    const messageIndex = Math.max(0, normInt(source?.messageIndex, 0));
    const lastMessageId =
      source?.lastMessageId !== undefined && source?.lastMessageId !== null
        ? source.lastMessageId
        : null;
    const createdAt = Number.isFinite(Number(source?.createdAt))
      ? Number(source.createdAt)
      : Date.now();

    const entry = {
      id:
        source?.id ||
        `summary-${createdAt}-${Math.floor(Math.random() * 100000)}`,
      text,
      messageIndex,
      lastMessageId,
      createdAt,
      sourceMessages,
    };
    if (source?._sunnyChatScope && typeof source._sunnyChatScope === "object") {
      entry._sunnyChatScope = source._sunnyChatScope;
    }
    entry.signature = buildStaticSummaryEntrySignature(entry);
    return entry;
  }

  function buildStaticSummaryEntrySignature(entry = {}) {
    return buildContextInjectionSignature([
      canonicalizeSignatureText(entry.text),
      entry.lastMessageId,
      entry.messageIndex,
      entry.sourceMessages,
    ]);
  }

  function getValidStaticSummaryEntries(mem = null) {
    const memory = mem || getChatMemory?.() || {};
    const entries = Array.isArray(memory.staticSummaryEntries)
      ? memory.staticSummaryEntries
      : Array.isArray(memory.summaryEntries)
        ? memory.summaryEntries
        : [];

    return entries
      .map((entry) => normalizeStaticSummaryEntrySource(entry))
      .filter(Boolean)
      .sort((a, b) => {
        const ai = normInt(a.messageIndex, 0);
        const bi = normInt(b.messageIndex, 0);
        if (ai !== bi) return ai - bi;
        return normInt(a.createdAt, 0) - normInt(b.createdAt, 0);
      });
  }

  function buildStaticSummaryInjectionText(mem = null, settings = null) {
    const entries = getValidStaticSummaryEntries(mem);
    if (!entries.length) return "";

    const keepLatest = getSummaryStaticKeepLatestSetting(settings);
    return entries
      .slice(-keepLatest)
      .map((entry) => entry.text)
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  function getSummaryTextForInjection(mem = null, settings = null) {
    const s = ensureSummaryPromptSettings(settings || {});
    const memory = mem || getChatMemory?.() || {};

    if (normalizeSummaryMode(s.summaryMode) === SUMMARY_MODE_STATIC) {
      return buildStaticSummaryInjectionText(memory, s) || String(memory.summary || "");
    }

    return String(memory.summary || "");
  }

  function saveDynamicSummary(text, sourceMessages = 0, upToMessageId = null) {
    const summaryText = String(text || "").trim();
    const memory = getChatMemory?.() || {};

    if (!summaryText) {
      setChatMemory?.({
        summary: "",
        _summaryChatScope: null,
        summarySnapshots: [],
        staticSummaryEntries: [],
        summaryEntries: [],
      });
      return "";
    }

    const ctx = getContext?.() || {};
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const lastIndex =
      upToMessageId !== null && upToMessageId !== undefined
        ? Math.max(0, normInt(upToMessageId, chat.length - 1))
        : Math.max(0, (getAbsoluteChatLength?.() || chat.length) - 1);
    const message =
      upToMessageId !== null && upToMessageId !== undefined
        ? chat[normInt(upToMessageId, chat.length - 1)]
        : chat[chat.length - 1];

    const snapshot = {
      messageIndex: lastIndex,
      lastMessageId: getMessageId?.(message) ?? null,
      text: summaryText,
      createdAt: Date.now(),
      sourceMessages: Math.max(0, normInt(sourceMessages, 0)),
      _sunnyChatScope: getSunnyChatScopeMeta(ctx, getMessageId, lastIndex),
    };

    setChatMemory?.({
      summary: summaryText,
      _summaryChatScope: snapshot._sunnyChatScope || null,
      summarySnapshots: [...(memory.summarySnapshots || []), snapshot].slice(-50),
    });

    return summaryText;
  }

  function appendStaticSummaryEntry(text, sourceMessages = 0, upToMessageId = null) {
    const summaryText = String(text || "").trim();
    if (!summaryText) return null;

    const s = ensureSummaryPromptSettings();
    const memory = getChatMemory?.() || {};
    const ctx = getContext?.() || {};
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const messageIndex =
      upToMessageId !== null && upToMessageId !== undefined
        ? Math.max(0, normInt(upToMessageId, chat.length - 1))
        : Math.max(0, (getAbsoluteChatLength?.() || chat.length) - 1);
    const message =
      upToMessageId !== null && upToMessageId !== undefined
        ? chat[normInt(upToMessageId, chat.length - 1)]
        : chat[chat.length - 1];

    const entry = normalizeStaticSummaryEntrySource({
      text: summaryText,
      messageIndex,
      lastMessageId: getMessageId?.(message) ?? null,
      createdAt: Date.now(),
      sourceMessages,
      _sunnyChatScope: getSunnyChatScopeMeta(ctx, getMessageId, messageIndex),
    });
    if (!entry) return null;

    const maxEntries = getSummaryStaticMaxEntriesSetting(s);
    const entries = [...getValidStaticSummaryEntries(memory), entry].slice(-maxEntries);
    const nextSummary = buildStaticSummaryInjectionText(
      { staticSummaryEntries: entries },
      s,
    );

    setChatMemory?.({
      summary: nextSummary,
      _summaryChatScope: entry._sunnyChatScope || null,
      staticSummaryEntries: entries,
      summaryEntries: entries,
    });

    return entry;
  }

  function saveStaticSummary(text, sourceMessages = 0, upToMessageId = null) {
    return appendStaticSummaryEntry(text, sourceMessages, upToMessageId);
  }

  function saveManualStaticSummary(text) {
    const summaryText = String(text || "").trim();
    if (!summaryText) return null;

    const memory = getChatMemory?.() || {};
    const entries = getValidStaticSummaryEntries(memory);
    if (entries.length) {
      const latest = entries[entries.length - 1];
      latest.text = summaryText;
      latest.createdAt = Date.now();
      if (!latest._sunnyChatScope) {
        const ctx = getContext?.() || {};
        latest._sunnyChatScope = getSunnyChatScopeMeta(ctx, getMessageId, latest.messageIndex ?? null);
      }
      latest.signature = buildStaticSummaryEntrySignature(latest);
      setChatMemory?.({
        summary: buildStaticSummaryInjectionText(
          { staticSummaryEntries: entries },
          ensureSummaryPromptSettings(),
        ),
        _summaryChatScope: latest._sunnyChatScope || null,
        staticSummaryEntries: entries,
        summaryEntries: entries,
      });
      return latest;
    }

    return appendStaticSummaryEntry(summaryText, 0, null);
  }

  function saveSummary(text, sourceMessages = 0, upToMessageId = null) {
    const s = ensureSummaryPromptSettings();
    if (normalizeSummaryMode(s.summaryMode) === SUMMARY_MODE_STATIC) {
      return saveManualStaticSummary(text);
    }
    return saveDynamicSummary(text, sourceMessages, upToMessageId);
  }

  return {
    normalizeSummaryMode,
    normalizeSummaryPromptSharing,
    ensureSummaryPromptSettings,
    getSummaryPromptForMode,
    persistSummaryPromptFieldValue,
    getSummaryModePrompt,
    buildSummaryAdditionalRequestBlock,
    getSummaryStaticKeepLatestSetting,
    getSummaryStaticMaxEntriesSetting,
    normalizeStaticSummaryEntrySource,
    buildStaticSummaryEntrySignature,
    getValidStaticSummaryEntries,
    buildStaticSummaryInjectionText,
    getSummaryTextForInjection,
    saveDynamicSummary,
    saveStaticSummary,
    saveManualStaticSummary,
    appendStaticSummaryEntry,
    saveSummary,
  };
}
