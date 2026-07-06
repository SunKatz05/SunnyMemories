export function createEventParser(deps) {
  const {
    $,
    extension_settings,
    extensionName,
    DEFAULT_CALENDAR,
    DEFAULT_CLASSIC_MONTHS,
    getAbsoluteDay,
    normalizeNumber,
    getVisibleChatRange,
    cleanMessage,
    getChatMemory,
    getCurrentProfileName,
    getExtensionProfileName,
    switchProfile,
    getBootstrapCalendarAnchorFromChat,
    writeCalendarSignalToMessage,
    getMessageId,
    safeGenerateRaw,
    parseAIResponseJSON,
    normalizeParsedEventsPayload,
    validateEvents,
    isGeneratingEvents,
    setGeneratingEvents,
    isAutoParsingEvents,
    setAutoParsingEvents,
    isGlobalProcessingLocked,
    getAbsoluteChatLength,
    ensureCalendar,
    renderCalendar,
    scheduleContextUpdate,
    toastr,
    t,
    lockUI,
    unlockUI,
    syncCalendarStateFromChat,
    getLatestCalendarSignal,
    setChatMemory,
    getContext,
    normalizeCalendarSignal,
    refreshCalendarAfterDateChange,
    buildDateKey,
  } = deps;

async function getChatHistoryTextRange(fromMessageId = 0, toMessageId = null) {
  const visibleChat = getVisibleChatRange(fromMessageId, toMessageId);
  if (visibleChat.length === 0) throw new Error(t("err_no_chat"));

  return visibleChat
    .map((m) => `${m.name ? m.name + ": " : ""}${cleanMessage(m.mes)}`)
    .join("\n\n");
}

function buildEventParsePrompt({
  historyText,
  calData,
  anchorDate,
  rangeMode = "last",
  rangeAmount = 50,
}) {
  const monthsDef = calData.months.map((m) => `${m.name} (${m.days} days)`).join(", ");

  return `
You are an event parser for a roleplay chat.

CALENDAR:
- Months order: [${monthsDef}]
- Fallback anchor date: Day ${anchorDate.day} of ${anchorDate.month}, Year ${anchorDate.year}

RULES:
- Extract only concrete timeline events that actually happened or are clearly implied.
- Prefer a few meaningful, high-signal events over many weak or trivial ones.
- Ignore minor chatter, repeated small actions, and vague statements unless they clearly matter to the timeline.
- If the chat contains an explicit infoblock date, treat it as the current world date and keep calendar.currentDate in sync with it.
- Hidden events must use "visibility": "hidden" and "exposureEveryDays": 0.
- Public events must use "visibility": "public".
- If something is uncertain, skip it rather than inventing a date or detail.
- Do not invent extra dates.
- Output JSON only.

INPUT RANGE:
- rangeMode: ${rangeMode}
- rangeAmount: ${rangeAmount}

SCHEMA:
{
  "events": [
    {
      "day": number,
      "month": "MonthName",
      "year": number,
      "title": "Short title",
      "summary": "What happened",
      "type": "story | social | random | weather | quest | character | world",
      "priority": "low | normal | high",
      "tags": ["tag1", "tag2"],
      "visibility": "public | hidden",
      "exposureEveryDays": number,
      "leadTimeDays": number,
      "confidence": number
    }
  ]
}

CHAT:
${historyText}
`.trim();
}

function shouldInjectCalendarEvent(e, evAbs, currentAbs) {
  const visibility = String(e?.visibility || "public").toLowerCase().trim();
  const state = String(e?.state || "").toLowerCase().trim();
  const revealAtAbs = Number.isFinite(Number(e?.revealAtAbs)) ? Number(e.revealAtAbs) : evAbs;

  const hiddenEvent =
    e?.wasHidden === true ||
    state === "hidden" ||
    visibility === "hidden" ||
    visibility === "visible";

  if (hiddenEvent) {
    return currentAbs === revealAtAbs;
  }

  const leadTimeDays = Math.max(0, normalizeNumber(e?.leadTimeDays, 0));
  const exposureEveryDays = Math.max(0, normalizeNumber(e?.exposureEveryDays, 0));
  const windowDays = Math.max(10, leadTimeDays, exposureEveryDays);

  return evAbs >= currentAbs && evAbs <= currentAbs + windowDays;
}

function normalizeEventText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}


function findMatchingCalendarEvent(events, ev) {
  const targetTitle = normalizeEventText(ev.title || ev.description);
  const targetType = normalizeEventText(ev.type || "event");

  return events.find((existing) => {
    if (!existing) return false;

    if (ev.id && existing.id === ev.id) return true;

    const sameSource =
      ev.sourceMessageId != null &&
      existing.sourceMessageId != null &&
      String(existing.sourceMessageId) === String(ev.sourceMessageId);

    const sameDate =
      existing.day === ev.day &&
      existing.month === ev.month &&
      existing.year === ev.year;

    if (!sameDate) return false;

    const existingTitle = normalizeEventText(existing.title || existing.description);
    const existingType = normalizeEventText(existing.type || "event");
    const sameTitleAndType = existingTitle === targetTitle && existingType === targetType;

    if (sameTitleAndType) return true;

    return sameSource && existingType === targetType && (!existingTitle || !targetTitle);
  });
}

function buildEventParseValidationBounds(calData, anchorDate) {
  const anchor = anchorDate || calData?.currentDate || DEFAULT_CALENDAR.currentDate;
  const months = calData?.months || DEFAULT_CLASSIC_MONTHS;
  const anchorAbs = getAbsoluteDay(anchor.year, anchor.month, anchor.day, months);
  const windowDays = 180;

  return {
    rangeStartAbs: Math.max(0, anchorAbs - windowDays),
    rangeEndAbs: anchorAbs + windowDays,
  };
}

function buildCalendarEventSavePayload(ev, existing = null, calMonths = DEFAULT_CLASSIC_MONTHS) {
  return {
    id: ev.id || existing?.id || "ai_ev_" + Date.now() + "_" + Math.floor(Math.random() * 100000),
    day: ev.day,
    month: ev.month,
    year: ev.year,
    title: ev.title,
    description: ev.description,
    type: ev.type,
    priority: ev.priority,
    tags: ev.tags,
    visibility: ev.visibility,
    state: ev.visibility === "hidden" ? "hidden" : "revealed",
    wasHidden:
      existing?.wasHidden === true ||
      ev?.wasHidden === true ||
      String(ev?.state || "").toLowerCase().trim() === "hidden" ||
      String(ev?.visibility || "public").toLowerCase().trim() === "hidden" ||
      String(ev?.visibility || "public").toLowerCase().trim() === "visible",
    revealAtAbs: Number.isFinite(Number(ev.revealAtAbs))
      ? Number(ev.revealAtAbs)
      : getAbsoluteDay(ev.year, ev.month, ev.day, calMonths),
    retainDays:
      ev.visibility === "hidden"
        ? Math.max(7, normalizeNumber(ev.retainDays, 30))
        : normalizeNumber(ev.retainDays, 0),
    exposureEveryDays: ev.exposureEveryDays,
    leadTimeDays: ev.leadTimeDays,
    confidence: ev.confidence ?? null,
    sourceMessageId: ev.sourceMessageId ?? null,
    dateSource: ev.dateSource ?? "calendar",
    parserMode: ev.parserMode ?? "manual",
  };
}

function commitCalendarEvents(events) {
  const mem = getChatMemory();
  const normalizedEvents = Array.isArray(events) ? events : [];

  if (!mem.calendar) {
    mem.calendar = JSON.parse(JSON.stringify(DEFAULT_CALENDAR));
  }

  if (!Array.isArray(mem.calendar.events)) {
    mem.calendar.events = [];
  }

  const calMonths = mem.calendar.months || DEFAULT_CLASSIC_MONTHS;
  let addedCount = 0;
  let updatedCount = 0;

  for (const ev of normalizedEvents) {
    if (!ev?.title && !ev?.description) continue;

    const existing = findMatchingCalendarEvent(mem.calendar.events, ev);
    const payload = buildCalendarEventSavePayload(ev, existing, calMonths);

    if (existing) {
      Object.assign(existing, payload);
      updatedCount++;
    } else {
      mem.calendar.events.push(payload);
      addedCount++;
    }
  }

  const hasChanges = addedCount > 0 || updatedCount > 0;
  if (hasChanges) {
    refreshCalendarAfterDateChange(mem, mem.calendar, {
      dateChanged: true,
    });
  }

  return { addedCount, updatedCount, calendarChanged: hasChanges };
}

async function runEventParseFromChat({
  fromMessageId = 0,
  toMessageId = null,
  rangeMode = null,
  rangeAmount = null,
  parserMode = "manual",
  allowOverwrite = false,
} = {}) {
  if (isGeneratingEvents()) {
    return null;
  }

  setGeneratingEvents(true);

  let profileSwitched = false;
  const originalProfile = getCurrentProfileName();

  try {
    const mem = getChatMemory();
    const calData = mem?.calendar || DEFAULT_CALENDAR;
    const settings = extension_settings[extensionName] || {};
    const targetProfile = getExtensionProfileName();
    const isAutoParser = parserMode === "auto";

    if (targetProfile && targetProfile !== originalProfile) {
      await switchProfile(targetProfile);
      profileSwitched = true;
    }

    const visibleChat = getVisibleChatRange(fromMessageId, toMessageId);

    const effectiveRangeMode =
      rangeMode ||
      (isAutoParser ? settings.eventAutoRangeMode : settings.eventRangeMode) ||
      "last";

    const effectiveRangeAmount = Math.max(
      1,
      normalizeNumber(
        rangeAmount ??
          (isAutoParser ? settings.eventAutoRangeAmount : settings.eventRangeAmount),
        isAutoParser ? 12 : 25,
      ),
    );

    const selectedChat =
      effectiveRangeMode === "all"
        ? visibleChat
        : effectiveRangeMode === "first"
          ? visibleChat.slice(0, effectiveRangeAmount)
          : visibleChat.slice(-effectiveRangeAmount);

    if (selectedChat.length === 0) {
      throw new Error(t("err_no_chat"));
    }

    const historyText = selectedChat
      .map((m) => `${m.name ? m.name + ": " : ""}${cleanMessage(m.mes)}`)
      .join("\n\n");

    const anchorDate = getBootstrapCalendarAnchorFromChat(selectedChat, calData, {
      allowLegacyTextScan: true,
    });

    const lastSelectedMessage = selectedChat[selectedChat.length - 1];

    if (anchorDate?.source !== "calendar" && lastSelectedMessage) {
      writeCalendarSignalToMessage(lastSelectedMessage, {
        mode: "setDate",
        day: anchorDate.day,
        month: anchorDate.month,
        year: anchorDate.year,
        source: anchorDate.source || "ai-bootstrap",
        rawText: anchorDate.rawText || "",
        sourceMessageId: anchorDate.sourceMessageId ?? getMessageId(lastSelectedMessage),
        confidence: anchorDate.source === "legacy-text-bootstrap" ? 0.4 : 0.7,
      });
    }

    const prompt = buildEventParsePrompt({
      historyText,
      calData,
      anchorDate,
      rangeMode: effectiveRangeMode,
      rangeAmount: effectiveRangeAmount,
    });

    const prefill = "{\n  \"events\": [\n    {";
    const resultText = await safeGenerateRaw(prompt, prefill);

    const parsed = parseAIResponseJSON(resultText);
    const parsedEvents = normalizeParsedEventsPayload(parsed);
    if (!parsedEvents) {
      console.error("SunnyMemories: Event parse payload is invalid.", {
        parsed,
        rawPreview: String(resultText || "").slice(0, 1000),
      });
      throw new Error("AI returned invalid JSON structure.");
    }

    const bounds = buildEventParseValidationBounds(calData, anchorDate);
    const validEvents = validateEvents(parsedEvents, calData, {
      ...bounds,
      anchorDate,
      sourceMessageId: getMessageId(lastSelectedMessage) ?? toMessageId ?? getAbsoluteChatLength() - 1,
      parserMode,
      allowOverwrite,
      style: "mixed",
      density: "low",
      visibility: "mixed",
    });

    return { validEvents, calData };
  } finally {
    setGeneratingEvents(false);

    if (profileSwitched && originalProfile) {
      try {
        await switchProfile(originalProfile);
      } catch (restoreErr) {
        console.error("Failed to restore profile after event parse:", restoreErr);
      }
    }
  }
}

async function maybeRunAutoEventParser() {
  const s = extension_settings[extensionName] || {};
  if (s.eventAutoParseEnabled !== true) return;
  if (isAutoParsingEvents() || isGlobalProcessingLocked() || isGeneratingEvents()) return;

  const chatLength = getAbsoluteChatLength();
  if (chatLength <= 0) return;

  const cadence = Math.max(1, normalizeNumber(s.eventAutoParseEvery, 5));
  const mem = getChatMemory();
  const cal = ensureCalendar(mem);
  const lastAutoParseChatLength = Math.max(
    0,
    normalizeNumber(cal.lastAutoParseChatLength, 0),
  );

  if (chatLength - lastAutoParseChatLength < cadence) {
    return;
  }

  setAutoParsingEvents(true);
  let parseSucceeded = false;

  try {
    const parseResult = await runEventParseFromChat({
      toMessageId: chatLength - 1,
      rangeMode: s.eventAutoRangeMode || "last",
      rangeAmount: s.eventAutoRangeAmount ?? 12,
      parserMode: "auto",
      allowOverwrite: Boolean(s.allowOverwrite),
    });

    if (!parseResult) return;

    parseSucceeded = true;

    const validEvents = parseResult.validEvents || [];
    if (validEvents.length === 0) {
      return;
    }

    const { addedCount, updatedCount, calendarChanged } = commitCalendarEvents(validEvents);

    if (calendarChanged) {
      renderCalendar();
      scheduleContextUpdate();
    }

    if (addedCount > 0 || updatedCount > 0) {
      toastr.info(
        t("saved_events_new_updated_x_y")
          .replace("{0}", String(addedCount))
          .replace("{1}", String(updatedCount)),
      );
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error("SunnyMemories auto event parse failed:", err);
  } finally {
    if (parseSucceeded) {
      cal.lastAutoParseChatLength = chatLength;
      setChatMemory({ calendar: cal });
    }
    setAutoParsingEvents(false);
  }
}

async function requestParsedEvents({
  fromMessageId = 0,
  toMessageId = null,
  rangeMode = null,
  rangeAmount = null,
} = {}) {
  if (isGlobalProcessingLocked()) return;
  if (isGeneratingEvents() || isAutoParsingEvents()) return;

  lockUI();

  const btn = $("#sm-btn-parse-events-now");
  const originalText = btn.length ? btn.html() : "";

  try {
    if (btn.length) {
      btn.html(`<i class="fa-solid fa-spinner fa-spin"></i> ${t("parsing")}`);
    }

    const settings = extension_settings[extensionName] || {};
    const parseResult = await runEventParseFromChat({
      fromMessageId,
      toMessageId,
      rangeMode,
      rangeAmount,
      parserMode: "manual",
      allowOverwrite: Boolean(settings.allowOverwrite),
    });

    if (!parseResult) return;

    const validEvents = parseResult.validEvents || [];
    if (validEvents.length === 0) {
      toastr.warning(t("no_valid_events_slice"));
      return;
    }

    const { addedCount, updatedCount, calendarChanged } = commitCalendarEvents(validEvents);

    if (calendarChanged) {
      renderCalendar();
      scheduleContextUpdate();
    }

    if (addedCount > 0 || updatedCount > 0) {
      toastr.success(
        t("saved_events_new_updated_x_y")
          .replace("{0}", String(addedCount))
          .replace("{1}", String(updatedCount)),
      );
    } else {
      toastr.info(t("no_valid_events_slice"));
    }
  } catch (e) {
    if (e?.name === "AbortError") return;
    console.error("AI Event Parsing Failed:", e);
    toastr.error(t("failed_parse_events_console"));
  } finally {
    unlockUI();
    if (btn.length) btn.html(originalText);
  }
}

async function requestManualCalendarSync() {
  const mem = getChatMemory();
  const toMessageId = getAbsoluteChatLength() - 1;
  const changed = syncCalendarStateFromChat(mem, toMessageId, {
    forceSignalApply: true,
  });
  const latestSignal = getLatestCalendarSignal(
    toMessageId,
    mem?.calendar || DEFAULT_CALENDAR,
  );

  renderCalendar();
  scheduleContextUpdate();

  if (changed) {
    toastr.success(t("calendar_synced_from_chat_infoblock"));
  } else if (latestSignal?.mode === "setDate") {
    toastr.info(t("date_infoblock_already_up_to_date"));
  } else {
    toastr.info(t("no_date_infoblock_found_visible_chat"));
  }
}

async function requestManualEventRefresh() {
  return requestManualCalendarSync();
}

async function requestCleanDateSignals() {
  const ctx = getContext();
  const mem = getChatMemory();
  const chat = getVisibleChatRange(0, getAbsoluteChatLength() - 1);

  if (!Array.isArray(chat) || chat.length === 0) {
    toastr.info(t("no_visible_chat_messages_to_clean"));
    return;
  }

  let cleaned = 0;
  for (const message of chat) {
    if (!message?.extra?.sunny_memories?.calendarSignal) continue;

    const sig = normalizeCalendarSignal(
      message.extra.sunny_memories.calendarSignal,
      mem?.calendar || DEFAULT_CALENDAR,
    );

    if (sig?.mode !== "setDate") continue;

    delete message.extra.sunny_memories.calendarSignal;
    cleaned++;
  }

  if (cleaned > 0) {
    if (!mem.calendar) mem.calendar = JSON.parse(JSON.stringify(DEFAULT_CALENDAR));
    delete mem.calendar.lastAppliedSignalMessageId;
    delete mem.calendar.lastAppliedSignalSignature;

    setChatMemory({ calendar: mem.calendar });
    if (ctx?.saveChat) ctx.saveChat();
    toastr.success(t("cleaned_date_signals_x").replace("{0}", String(cleaned)));
  } else {
    toastr.info(t("no_date_signal_metadata_to_clean"));
  }
}


  return {
    getChatHistoryTextRange,
    buildEventParsePrompt,
    shouldInjectCalendarEvent,
    normalizeEventText,
    findMatchingCalendarEvent,
    buildEventParseValidationBounds,
    buildCalendarEventSavePayload,
    commitCalendarEvents,
    runEventParseFromChat,
    maybeRunAutoEventParser,
    requestParsedEvents,
    requestManualCalendarSync,
    requestManualEventRefresh,
    requestCleanDateSignals,
  };
}
