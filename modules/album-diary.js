import {
  ALBUM_DIARY_CHAT_CONTEXT_MAX_CHARS,
  ALBUM_DIARY_CHAT_CONTEXT_MESSAGES,
  ALBUM_DIARY_MAX_WORDS,
  DEFAULT_ALBUM_DIARY_PROMPT,
} from "./constants.js";
import {
  getAlbumPromptTextFromGenerationMeta,
  trimToWordLimit,
} from "./utils/album-core-utils.js";
import {
  cleanMessage,
  getVisibleChatRange,
} from "./utils/chat-utils.js";
import { normalizeNumber } from "./utils/common-utils.js";

function fallbackTranslate(key) {
  return String(key || "");
}

export function getAlbumDiaryRecentChatContext(
  limit = ALBUM_DIARY_CHAT_CONTEXT_MESSAGES,
  maxChars = ALBUM_DIARY_CHAT_CONTEXT_MAX_CHARS,
) {
  const chat = getVisibleChatRange(0, null);
  if (!Array.isArray(chat) || chat.length === 0) return "";

  const safeLimit = Math.max(1, normalizeNumber(limit, ALBUM_DIARY_CHAT_CONTEXT_MESSAGES));
  const tail = chat.slice(-safeLimit);
  const lines = [];

  for (const message of tail) {
    const rawText = cleanMessage(message?.mes || "").replace(/\s+/g, " ").trim();
    if (!rawText) continue;
    const role = message?.is_user === true ? "User" : "Assistant";
    const clipped = rawText.length > 420 ? `${rawText.slice(0, 417)}...` : rawText;
    lines.push(`${role}: ${clipped}`);
  }

  const combined = lines.join("\n").trim();
  if (!combined) return "";
  if (combined.length <= maxChars) return combined;
  return `${combined.slice(0, maxChars).trimEnd()}...`;
}

export function buildAlbumDiaryCaptionPrompt(
  userPrompt,
  generationPrompt = "",
  recentChatContext = "",
) {
  const promptBase =
    String(userPrompt || "").trim() || DEFAULT_ALBUM_DIARY_PROMPT;
  const safeGenerationPrompt = String(generationPrompt || "").trim().slice(0, 1600);
  const safeRecentChatContext = String(recentChatContext || "").trim();

  const contextLines = [];
  if (safeGenerationPrompt) {
    contextLines.push(`- Generation prompt context: ${safeGenerationPrompt}`);
  }

  const metadataContextBlock = contextLines.length
    ? `\n\nGeneration metadata context:\n${contextLines.join("\n")}`
    : "";
  const recentChatBlock = safeRecentChatContext
    ? `\n\nRecent chat context (latest messages):\n${safeRecentChatContext}`
    : "";

  return `${promptBase}${metadataContextBlock}${recentChatBlock}\n\nOutput rules:\n- Return plain text only.\n- One diary entry paragraph.\n- Write strictly in first person as {{char}}.\n- Make it feel like a diary note with personal thoughts, emotions, and opinion.\n- Do not describe every action step-by-step; this is not a narrative chronicle.\n- Maximum ${ALBUM_DIARY_MAX_WORDS} words.`;
}

export async function generateAlbumDiaryEntryFromContext(
  generationMeta,
  recentChatContext,
  settings = null,
  {
    generateRawText,
    translate,
    notify,
  } = {},
) {
  const s = settings || {};
  if (s.albumDiaryMode !== true) return "";

  const t = typeof translate === "function" ? translate : fallbackTranslate;
  const generationPrompt = getAlbumPromptTextFromGenerationMeta(generationMeta);
  const diaryPrompt = buildAlbumDiaryCaptionPrompt(
    s.albumDiaryPrompt,
    generationPrompt,
    recentChatContext,
  );

  try {
    if (typeof generateRawText !== "function") return "";
    const captionRaw = await generateRawText(diaryPrompt);
    return trimToWordLimit(captionRaw, ALBUM_DIARY_MAX_WORDS);
  } catch (error) {
    console.warn("SunnyMemories: diary caption generation failed", error);
    notify?.warning?.(t("album_diary_caption_failed"));
    return "";
  }
}
