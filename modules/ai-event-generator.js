export function createAiEventGenerator(deps) {
  const {
    $,
    extension_settings,
    extensionName,
    DEFAULT_CALENDAR,
    getActiveSettingsRoot,
    getScopedFieldValue,
    getAbsoluteDay,
    escapeHtml,
    normalizeNumber,
    getChatMemory,
    buildDateKey,
    getContext,
    cleanMessage,
    isGlobalProcessingLocked,
    lockUI,
    unlockUI,
    getCurrentProfileName,
    getExtensionProfileName,
    getCheckboxValue,
    getInputValue,
    switchProfile,
    safeGenerateRaw,
    parseAIResponseJSON,
    normalizeParsedEventsPayload,
    toastr,
    t,
    commitCalendarEvents,
    getPendingAiEvents,
    setPendingAiEvents,
  } = deps;

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getYearLength(calData) {
  return (calData?.months || []).reduce((sum, m) => sum + normalizeNumber(m.days, 30), 0);
}

function getRangeFromUI(calData) {
  const months = calData?.months || [];
  if (!months.length) throw new Error("Calendar months are missing.");

  const startDayRaw = getScopedFieldValue("#sm-range-start-day", 1);
  const startMonthRaw = getScopedFieldValue("#sm-range-start-month", months[0].name);
  const startYearRaw = getScopedFieldValue("#sm-range-start-year", calData.currentDate?.year || 2025);

  const start = {
    day: normalizeNumber(startDayRaw, 1),
    month: String(startMonthRaw || months[0].name),
    year: normalizeNumber(startYearRaw, calData.currentDate?.year || 2025),
  };

  const endDayRaw = getScopedFieldValue("#sm-range-end-day", 1);
  const endMonthRaw = getScopedFieldValue("#sm-range-end-month", months[months.length - 1].name);
  const endYearRaw = getScopedFieldValue("#sm-range-end-year", start.year);

  const end = {
    day: normalizeNumber(endDayRaw, 1),
    month: String(endMonthRaw || months[months.length - 1].name),
    year: normalizeNumber(endYearRaw, start.year),
  };

  const startAbs = getAbsoluteDay(start.year, start.month, start.day, calData.months);
  const endAbs = getAbsoluteDay(end.year, end.month, end.day, calData.months);

  if (endAbs < startAbs) {
    const tmp = { ...start };
    start.day = end.day;
    start.month = end.month;
    start.year = end.year;
    end.day = tmp.day;
    end.month = tmp.month;
    end.year = tmp.year;
  }

  const fixedStartAbs = getAbsoluteDay(start.year, start.month, start.day, calData.months);
  const fixedEndAbs = getAbsoluteDay(end.year, end.month, end.day, calData.months);

  const maxSpan = getYearLength(calData) * 2;
  if ((fixedEndAbs - fixedStartAbs) > maxSpan) {
    throw new Error("Date range must not exceed 2 years.");
  }

  return { start, end, startAbs: fixedStartAbs, endAbs: fixedEndAbs };
}

function fillRangeMonthSelects(calData) {
  const root = getActiveSettingsRoot();
  const startSelect = root.length ? root.find("#sm-range-start-month").last() : $("#sm-range-start-month").last();
  const endSelect = root.length ? root.find("#sm-range-end-month").last() : $("#sm-range-end-month").last();
  if (!startSelect.length || !endSelect.length) return;

  const s = extension_settings[extensionName] || {};
  const months = calData?.months || [];
  const curMonth = calData?.currentDate?.month || months[0]?.name || "";
  const selectedStartMonth = String(startSelect.val() || "");
  const selectedEndMonth = String(endSelect.val() || "");

  startSelect.empty();
  endSelect.empty();

  months.forEach((m) => {
    const opt = `<option value="${escapeAttr(m.name)}">${escapeHtml(m.name)}</option>`;
    startSelect.append(opt);
    endSelect.append(opt);
  });

  if (months.length) {
    const monthNames = new Set(months.map((m) => String(m.name)));
    const desiredStartMonth = selectedStartMonth || s.eventDateRangeStartMonth || curMonth;
    const desiredEndMonth = selectedEndMonth || s.eventDateRangeEndMonth || curMonth;

    startSelect.val(monthNames.has(String(desiredStartMonth)) ? desiredStartMonth : curMonth);
    endSelect.val(monthNames.has(String(desiredEndMonth)) ? desiredEndMonth : curMonth);
  }
}


function getAiEventMonthOptions(selectedMonth) {
  const mem = getChatMemory();
  const months = mem?.calendar?.months || [];

  const normalizedSelected = String(selectedMonth || "")
    .trim()
    .toLowerCase();

  return months
    .map(m => {
      const normalizedName = String(m.name).trim().toLowerCase();
      const selected = normalizedName === normalizedSelected ? "selected" : "";
      return `<option value="${escapeAttr(m.name)}" ${selected}>${escapeHtml(m.name)}</option>`;
    })
    .join("");
}

function normalizeVisibilityMode(value) {
  const v = String(value || "").toLowerCase().trim();
  if (v === "mixed") return "mixed";
  if (v === "hidden" || v === "secret" || v === "private") return "hidden";
  return "public";
}

const EVENT_STYLE_VALUES = new Set([
  "story",
  "social",
  "random",
  "weather",
  "quest",
  "character",
  "world",
]);

function normalizeEventStyle(value) {
  const v = String(value || "mixed").toLowerCase().trim();
  if (!v || v === "mixed") return "mixed";

  if (v === "public" || v === "hidden") return "mixed";
  if (v === "event") return "story";

  return EVENT_STYLE_VALUES.has(v) ? v : "mixed";
}

function normalizeEventType(value, fallbackType = "story") {
  const v = String(value || "").toLowerCase().trim();
  if (EVENT_STYLE_VALUES.has(v)) return v;
  return EVENT_STYLE_VALUES.has(fallbackType) ? fallbackType : "story";
}

function formatCalendarEventForContext(e) {
  const title = String(e.title || e.description || "Event").trim();
  const meta = [];

  if (e.type) meta.push(`type:${e.type}`);
  if (e.priority) meta.push(`priority:${e.priority}`);
  if (e.visibility) meta.push(`visibility:${e.visibility}`);
  if (Number.isFinite(Number(e.leadTimeDays)) && Number(e.leadTimeDays) > 0) {
    meta.push(`lead:${Number(e.leadTimeDays)}`);
  }
  if (Number.isFinite(Number(e.exposureEveryDays)) && Number(e.exposureEveryDays) > 0) {
    meta.push(`exposure:${Number(e.exposureEveryDays)}`);
  }

  return {
    title,
    line: `РІР‚Сћ Day ${e.day} ${e.month} РІР‚вЂќ ${title}${meta.length ? ` [${meta.join(", ")}]` : ""}`,
    extra: e.description && e.description !== title ? `  ${e.description}` : "",
  };
}

function normalizeMonthName(name, calData) {
  if (!name) return null;
  if (!calData?.months?.length) return String(name).trim();
  const target = String(name).toLowerCase().trim();
  const match = calData.months.find(m => String(m.name).toLowerCase().trim() === target);
  return match ? match.name : String(name).trim();
}
function getExistingEventKeys(calData) {
  const keys = new Set();
  if (!calData?.events?.length) return keys;

  for (const e of calData.events) {
    if (e && e.year != null && e.month != null && e.day != null) {
      keys.add(buildDateKey(e.year, e.month, e.day));
    }
  }
  return keys;
}

function safeExtractWorldLore(stCtx, options) {
  const parts = [];

  if (options.useWorldInfo) {
    const windowAny = typeof window !== "undefined" ? /** @type {any} */ (window) : null;
    const candidates = [
      stCtx?.worldInfo,
      stCtx?.world_info,
      windowAny?.world_info,
      windowAny?.worldInfo,
    ];

    for (const wi of candidates) {
      if (!wi) continue;

      if (Array.isArray(wi)) {
        const snippet = wi
          .slice(0, 20)
          .map((item, idx) => {
            if (typeof item === "string") return `WI ${idx + 1}: ${item}`;
            if (item && typeof item === "object") {
              return `WI ${idx + 1}: ${item.comment || item.key || item.displayName || JSON.stringify(item)}`;
            }
            return null;
          })
          .filter(Boolean)
          .join("\n");

        if (snippet) {
          parts.push(`<world_info>\n${snippet}\n</world_info>`);
          break;
        }
      } else if (typeof wi === "object") {
        const text =
          wi.text ||
          wi.content ||
          wi.description ||
          wi.summary ||
          wi.name ||
          null;

        if (text) {
          parts.push(`<world_info>\n${text}\n</world_info>`);
          break;
        }
      } else if (typeof wi === "string" && wi.trim()) {
        parts.push(`<world_info>\n${wi.trim()}\n</world_info>`);
        break;
      }
    }
  }
  return parts.join("\n");
}

async function collectGenerationContext(options) {
  const stCtx = getContext();
  const mem = getChatMemory();

  let ctxString = "<context>\n";

  if (options.useSummary && mem?.summary) {
    ctxString += `<story_summary>\n${mem.summary}\n</story_summary>\n`;
  }

  if (options.useCharacterCard && stCtx?.characterId !== undefined) {
    const char = stCtx.characters?.[stCtx.characterId];
    if (char) {
      ctxString += `<character_card>\n`;
      ctxString += `Name: ${char.name || ""}\n`;
      ctxString += `Persona: ${char.description || ""}\n`;
      ctxString += `Scenario: ${char.scenario || ""}\n`;
      ctxString += `</character_card>\n`;
    }
  }

  const loreBlock = safeExtractWorldLore(stCtx, options);
  if (loreBlock) {
    ctxString += `${loreBlock}\n`;
  }

  if (options.useChatHistory && Array.isArray(stCtx?.chat) && stCtx.chat.length > 0) {
    const recentChat = stCtx.chat
      .slice(-30)
      .filter(m => !m?.is_system)
      .map(m => `${m.name || "Unknown"}: ${cleanMessage(m.mes || "")}`)
      .join("\n");

    if (recentChat.trim()) {
      ctxString += `<recent_chat>\n${recentChat}\n</recent_chat>\n`;
    }
  }

  if (options.useAuthorNote && stCtx?.settings?.authors_note) {
    ctxString += `<authors_note>\n${stCtx.settings.authors_note}\n</authors_note>\n`;
  }


  ctxString += "</context>\n";
  return ctxString;
}

function buildGenerationPrompt(contextString, options, calData) {
  const curDate = calData.currentDate;
  const monthsDef = calData.months.map(m => `${m.name} (${m.days} days)`).join(", ");

  const spanDays = Math.max(0, options.rangeEndAbs - options.rangeStartAbs);

let pacingInstruction = "";
if (spanDays <= 14) pacingInstruction = "Generate small, frequent events. Keep them believable.";
else if (spanDays <= 60) pacingInstruction = "Generate moderately paced events and small chains of consequences.";
else if (spanDays <= 180) pacingInstruction = "Form mini-arcs. Space major beats out by weeks.";
else pacingInstruction = "Generate rare, major, and highly significant events spaced out by months.";

  let densityInstruction = "";
  if (options.density === "low") densityInstruction = "Keep density low. Avoid overcrowding dates.";
  else if (options.density === "medium") densityInstruction = "Use a balanced amount of events.";
  else densityInstruction = "Use high density. Multiple events per week are allowed.";

  let visibilityInstruction = "";
if (options.visibility === "mixed") {
  visibilityInstruction =
    "Mix public and hidden events naturally. Aim for roughly half public forecast events and half hidden surprises. Public events must have exposureEveryDays > 0. Hidden events must have exposureEveryDays = 0.";
} else if (options.visibility === "hidden") {
  visibilityInstruction =
    "All events in the output must be hidden-from-characters style events. They should be unknown before the date happens. Set exposureEveryDays to 0.";
} else {
  visibilityInstruction =
    "All events in the output should be public forecast events. Set exposureEveryDays to a positive integer and use leadTimeDays when relevant.";
}

  const styleFocus = normalizeEventStyle(options.style);
  const styleInstruction =
    styleFocus === "mixed"
      ? "Use a balanced mix of event types (story, social, random, weather, quest, character, world)."
      : `Strongly prefer the "${styleFocus}" type for generated events.`;

  const generationWishes = String(options.generationWishes || "").trim();
  const generationWishesBlock = generationWishes
    ? `USER WISHES:
- Follow these additional preferences when possible, without breaking any hard rules above.
${generationWishes}

`
    : "";

  const prompt = `
You are an AI Calendar Manager for a roleplay timeline.

Your job:
Generate future timeline events based on the provided context.

CALENDAR RULES:
- The current date is Day ${curDate.day} of ${curDate.month}, Year ${curDate.year}.
- The calendar uses these months in order: [${monthsDef}].
- Generate events only within this date range:
  from Day ${options.rangeStart.day} of ${options.rangeStart.month}, Year ${options.rangeStart.year}
  to Day ${options.rangeEnd.day} of ${options.rangeEnd.month}, Year ${options.rangeEnd.year}.
- Do not generate anything outside this range.
- If visibility mode is mixed, include both public and hidden events in a balanced way.
- ${pacingInstruction}
- ${densityInstruction}
- ${visibilityInstruction}
- ${styleInstruction}

VISIBILITY / INSERTION RULES:
- visibility = "public" means the event can be known ahead of time and may be inserted into context repeatedly before it happens.
- visibility = "hidden" means nobody knows it will happen until the event date.
- If visibility is "public", set "exposureEveryDays" to a positive integer if the event should be resurfaced periodically before it happens.
- If visibility is "hidden", set "exposureEveryDays" to 0.
- Use "leadTimeDays" to describe how many days before the event it should start appearing in context, if relevant.
- Do not invent contradictory dates or impossible month/day combinations.

${generationWishesBlock}${contextString}

OUTPUT FORMAT:
Respond ONLY with raw JSON.
No markdown. No explanations. No code fences.

Schema:
{
  "events": [
    {
      "day": number,
      "month": "MonthName (exactly as listed above)",
      "year": number,
      "title": "Short event title",
      "type": "story | social | random | weather | quest | character | world",
      "priority": "low | normal | high",
      "summary": "Detailed description of what happens",
      "tags": ["tag1", "tag2"],
      "visibility": "public | hidden",
      "exposureEveryDays": number,
      "leadTimeDays": number,
      "confidence": number
    }
  ]
}
`.trim();

  return prompt;
}

async function requestGeneratedEvents() {
  if (isGlobalProcessingLocked()) return;

  const btn = $("#sm-btn-run-ai-events");
  const originalText = btn.html();

  let profileSwitched = false;
  const originalProfile = getCurrentProfileName();

  try {
    lockUI();
    btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Generating...');

    const mem = getChatMemory();
    const calData = mem?.calendar || DEFAULT_CALENDAR;
    const range = getRangeFromUI(calData);

    const targetProfile = getExtensionProfileName();
    const options = {
      useCharacterCard: getCheckboxValue("#sm-ev-ctx-char"),
      useWorldInfo: getCheckboxValue("#sm-ev-ctx-wi"),
      useSummary: getCheckboxValue("#sm-ev-ctx-sum"),
      useChatHistory: getCheckboxValue("#sm-ev-ctx-chat"),
      useAuthorNote: getCheckboxValue("#sm-ev-ctx-an"),
      style: normalizeEventStyle(getInputValue("#sm-ev-param-style", "mixed")),
      density: getInputValue("#sm-ev-param-density", "medium"),
      visibility: normalizeVisibilityMode(getInputValue("#sm-ev-param-visibility", "mixed")),
      exposureEveryDays: normalizeNumber(getInputValue("#sm-ev-param-exposure-every", "0"), 0),
      allowOverwrite: getCheckboxValue("#sm-ev-param-overwrite"),
      generationWishes: String(getInputValue("#sm-ev-gen-wishes", "") || "").trim(),
      rangeStart: range.start,
      rangeEnd: range.end,
      rangeStartAbs: range.startAbs,
      rangeEndAbs: range.endAbs,
    };

    if (targetProfile && targetProfile !== originalProfile) {
      await switchProfile(targetProfile);
      profileSwitched = true;
    }

    const contextStr = await collectGenerationContext(options);
    const prompt = buildGenerationPrompt(contextStr, options, calData);

    const prefill = "{\n  \"events\": [\n    {";
    const resultText = await safeGenerateRaw(prompt, prefill);

    const parsed = parseAIResponseJSON(resultText);
    const parsedEvents = normalizeParsedEventsPayload(parsed);
    if (!parsedEvents) {
      console.error("SunnyMemories: AI event generation payload is invalid.", {
        parsed,
        rawPreview: String(resultText || "").slice(0, 1000),
      });
      throw new Error("AI returned invalid JSON structure.");
    }

    const validEvents = validateEvents(parsedEvents, calData, options);

    if (validEvents.length === 0) {
      toastr.warning(t("no_valid_events_generated_adjust_settings"));
      $("#sm-events-generator-inline").hide();
      $("#sm-events-preview-inline").hide();
      return;
    }

    setPendingAiEvents(validEvents);
    showPreviewModal();
  } catch (e) {
    if (e?.name === "AbortError") return;
    console.error("AI Event Generation Failed:", e);
    toastr.error(t("failed_generate_events_console"));
  } finally {
    unlockUI();
    btn.html(originalText);

    if (profileSwitched && originalProfile) {
      try {
        await switchProfile(originalProfile);
      } catch (restoreErr) {
        console.error("Failed to restore original profile after AI event generation:", restoreErr);
      }
    }
  }
}


function validateEvents(rawEvents, calData, options) {
  const valid = [];
  const existingDates = getExistingEventKeys(calData);
  const seenSignatures = new Set();
  const styleFocus = normalizeEventStyle(options.style);

  const maxPerDay =
    options.density === "high" ? 999 : options.density === "medium" ? 3 : 2;

  const anchor = options.anchorDate || calData.currentDate || DEFAULT_CALENDAR.currentDate;

  for (const e of rawEvents) {
    if (!e || e.day == null || !e.month || e.year == null) continue;

    const normalizedMonth = normalizeMonthName(e.month, calData) || anchor.month;
    if (!normalizedMonth) continue;

    const monthIndex = calData.months.findIndex((m) => m.name === normalizedMonth);
    const maxDays = monthIndex !== -1 ? normalizeNumber(calData.months[monthIndex].days, 30) : 31;

    const dayNum = normalizeNumber(e.day, anchor.day);
    const yearNum = normalizeNumber(e.year, anchor.year);

    if (dayNum < 1 || dayNum > maxDays) continue;
    if (yearNum <= 0) continue;

    const dateKey = buildDateKey(yearNum, normalizedMonth, dayNum);
    const evAbs = getAbsoluteDay(yearNum, normalizedMonth, dayNum, calData.months);
    if (evAbs < options.rangeStartAbs || evAbs > options.rangeEndAbs) continue;

    if (!options.allowOverwrite && existingDates.has(dateKey)) continue;

    const rawTitle = String(e.title ?? "").trim();
    const rawSummary = String(e.summary ?? e.description ?? "").trim();

    const title = rawTitle || rawSummary.slice(0, 80) || "Untitled event";
    const summary = rawSummary || title;
    const type =
      styleFocus === "mixed"
        ? normalizeEventType(e.type, "story")
        : styleFocus;

    const priority = ["low", "normal", "high"].includes(String(e.priority).toLowerCase())
      ? String(e.priority).toLowerCase()
      : "normal";

    const visibilityMode = normalizeVisibilityMode(e.visibility || options.visibility);
    const visibility =
      visibilityMode === "mixed"
        ? ((yearNum + dayNum + monthIndex) % 2 === 0 ? "public" : "hidden")
        : visibilityMode;

    const rangeSpan = Math.max(0, options.rangeEndAbs - options.rangeStartAbs);
    const defaultExposureEveryDays = Math.max(3, Math.min(21, Math.round(rangeSpan / 10) || 7));

    const rawExposure =
      e.exposureEveryDays == null || e.exposureEveryDays === ""
        ? null
        : normalizeNumber(e.exposureEveryDays, 0);

    const exposureEveryDays =
      visibility === "hidden"
        ? 0
        : rawExposure && rawExposure > 0
          ? rawExposure
          : defaultExposureEveryDays;

    const leadTimeDays =
      visibility === "hidden"
        ? 0
        : Math.max(0, normalizeNumber(e.leadTimeDays, Math.min(7, defaultExposureEveryDays)));

    const tags = Array.isArray(e.tags)
      ? e.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
      : [];

    const signature = `${dateKey}|${title.toLowerCase()}|${type}|${summary.toLowerCase()}|${String(options.parserMode || "manual")}`;
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);

    const sameDayCount = valid.filter(
      (v) => v.year === yearNum && v.month === normalizedMonth && v.day === dayNum,
    ).length;
    if (sameDayCount >= maxPerDay) continue;

        const revealAtAbs = evAbs;
    const retainDays =
      visibility === "hidden"
        ? Math.max(7, normalizeNumber(e.retainDays, 30))
        : normalizeNumber(e.retainDays, 0);

        valid.push({
      id: "ai_ev_" + Date.now() + "_" + Math.floor(Math.random() * 100000),
      day: dayNum,
      month: normalizeMonthName(e.month, calData.months),
      year: yearNum,
      title,
      description: summary,
      type,
      priority,
      tags,
      visibility,
      state: visibility === "hidden" ? "hidden" : "revealed",
      revealAtAbs,
      retainDays,
      exposureEveryDays,
      leadTimeDays,
      confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : null,
      sourceMessageId: options.sourceMessageId ?? null,
      dateSource: anchor.source || "calendar",
      parserMode: options.parserMode || "manual",
    });
  }

  valid.sort(

    (a, b) =>
      getAbsoluteDay(a.year, a.month, a.day, calData.months) -
      getAbsoluteDay(b.year, b.month, b.day, calData.months),
  );

  return valid;
}

function showPreviewModal() {
  $("#sm-events-inline-panel").stop(true, true).slideDown(200);
  $("#sm-events-generator-inline").hide();
  $("#sm-events-parser-inline").hide();

  const container = $("#sm-preview-list-container");
  container.empty();
  $("#sm-preview-count").text(getPendingAiEvents().length);

  getPendingAiEvents().forEach((ev, idx) => {
    const tagValue = (ev.tags || []).join(", ");
    const priorityColor =
      ev.priority === "high"
        ? "var(--SmartThemeAlertColor)"
        : ev.priority === "low"
          ? "var(--SmartThemeBodyColor)"
          : "var(--SmartThemeQuoteColor)";

    const visibilityOptions = `
      <option value="public" ${ev.visibility === "hidden" ? "" : "selected"}>${t("public")}</option>
      <option value="hidden" ${ev.visibility === "hidden" ? "selected" : ""}>${t("hidden")}</option>
    `;

    const monthOptions = getAiEventMonthOptions(ev.month);

    const html = `
      <div class="sm-preview-item" data-idx="${idx}">
        <input type="checkbox" class="sm-preview-checkbox" data-idx="${idx}" checked>
        <div class="sm-preview-item-content">
          <div class="sm-preview-grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
            <label>
              <div class="sm-preview-desc">${t("day_col")}</div>
              <input class="text_pole sm-ai-ev-day" data-idx="${idx}" type="number" min="1" value="${escapeAttr(ev.day)}">
            </label>

            <label>
              <div class="sm-preview-desc">${t("month_col")}</div>
              <select class="text_pole sm-ai-ev-month" data-idx="${idx}">
                ${monthOptions}
              </select>
            </label>

            <label>
              <div class="sm-preview-desc">${t("year_col")}</div>
              <input class="text_pole sm-ai-ev-year" data-idx="${idx}" type="number" value="${escapeAttr(ev.year)}">
            </label>

            <label>
              <div class="sm-preview-desc">${t("type")}</div>
              <input class="text_pole sm-ai-ev-type" data-idx="${idx}" type="text" value="${escapeAttr(ev.type || "event")}">
            </label>

            <label>
              <div class="sm-preview-desc">${t("priority")}</div>
              <select class="text_pole sm-ai-ev-priority" data-idx="${idx}">
                <option value="low" ${ev.priority === "low" ? "selected" : ""}>${t("priority_low")}</option>
                <option value="normal" ${ev.priority === "normal" || !ev.priority ? "selected" : ""}>${t("priority_normal")}</option>
                <option value="high" ${ev.priority === "high" ? "selected" : ""}>${t("priority_high")}</option>
              </select>
            </label>

            <label>
              <div class="sm-preview-desc">${t("visibility")}</div>
              <select class="text_pole sm-ai-ev-visibility" data-idx="${idx}">
                ${visibilityOptions}
              </select>
            </label>

            <label style="grid-column:1 / -1;">
              <div class="sm-preview-desc">${t("title_label")}</div>
              <input class="text_pole sm-ai-ev-title" data-idx="${idx}" type="text" value="${escapeAttr(ev.title || "")}">
            </label>

            <label style="grid-column:1 / -1;">
              <div class="sm-preview-desc">${t("description_label")}</div>
              <textarea class="text_pole sm-ai-ev-description" data-idx="${idx}" rows="3">${escapeHtml(ev.description || "")}</textarea>
            </label>

            <label style="grid-column:1 / -1;">
              <div class="sm-preview-desc">${t("tags_comma_separated")}</div>
              <input class="text_pole sm-ai-ev-tags" data-idx="${idx}" type="text" value="${escapeAttr(tagValue)}">
            </label>

            <label>
              <div class="sm-preview-desc">${t("exposure_every_n_days")}</div>
              <input class="text_pole sm-ai-ev-exposure" data-idx="${idx}" type="number" min="0" value="${escapeAttr(ev.exposureEveryDays ?? 0)}">
            </label>

            <label>
              <div class="sm-preview-desc">${t("lead_time_days")}</div>
              <input class="text_pole sm-ai-ev-lead" data-idx="${idx}" type="number" min="0" value="${escapeAttr(ev.leadTimeDays ?? 0)}">
            </label>
          </div>

          <div class="sm-preview-desc" style="opacity:.85;margin-top:8px;">
            ${t("preview_color")}: <span style="color:${priorityColor};font-weight:bold;">${escapeHtml(String(ev.priority || "normal"))}</span>
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
  <button type="button" class="menu_button sm-preview-regen" data-idx="${idx}" style="padding:6px 10px; font-size:0.85em;">
    <i class="fa-solid fa-rotate-right" style="margin-right:5px;"></i>${t("regenerate")}
  </button>
  <button type="button" class="menu_button sm-preview-delete" data-idx="${idx}" style="padding:6px 10px; font-size:0.85em; color:var(--SmartThemeAlertColor);">
    <i class="fa-solid fa-trash" style="margin-right:5px;"></i>${t("remove")}
  </button>
</div>
        </div>
      </div>
    `;
    container.append(html);
  });

$("#sm-events-preview-inline").slideDown(200);
$("#sm-events-generator-inline").slideUp(200);
}

function readAiPreviewEvents() {
  const edited = [];

  getPendingAiEvents().forEach((baseEv, idx) => {
    const selected = $(`.sm-preview-checkbox[data-idx="${idx}"]`).is(":checked");
    if (!selected) return;

    const day = normalizeNumber($(`.sm-ai-ev-day[data-idx="${idx}"]`).val(), baseEv.day);
    const month = String($(`.sm-ai-ev-month[data-idx="${idx}"]`).val() || baseEv.month || "").trim();
    const year = normalizeNumber($(`.sm-ai-ev-year[data-idx="${idx}"]`).val(), baseEv.year);
    const title = String($(`.sm-ai-ev-title[data-idx="${idx}"]`).val() || baseEv.title || "").trim();
    const description = String($(`.sm-ai-ev-description[data-idx="${idx}"]`).val() || baseEv.description || "").trim();
    const type = String($(`.sm-ai-ev-type[data-idx="${idx}"]`).val() || baseEv.type || "event").trim().toLowerCase();
    const priority = String($(`.sm-ai-ev-priority[data-idx="${idx}"]`).val() || baseEv.priority || "normal").trim().toLowerCase();
    const visibility = String($(`.sm-ai-ev-visibility[data-idx="${idx}"]`).val() || baseEv.visibility || "public").trim().toLowerCase();
    const tags = parseTagsInput($(`.sm-ai-ev-tags[data-idx="${idx}"]`).val());
    const exposureEveryDays = normalizeNumber($(`.sm-ai-ev-exposure[data-idx="${idx}"]`).val(), baseEv.exposureEveryDays || 0);
    const leadTimeDays = normalizeNumber($(`.sm-ai-ev-lead[data-idx="${idx}"]`).val(), baseEv.leadTimeDays || 0);

    edited.push({
      ...baseEv,
      day,
      month,
      year,
      title,
      description,
      type,
      priority,
      visibility,
      tags,
      exposureEveryDays,
      leadTimeDays,
    });
  });

  return edited;
}

async function regenerateSinglePreviewEvent(idx) {
  const baseEv = getPendingAiEvents()[idx];
  if (!baseEv) return;

  const btn = $(`.sm-preview-regen[data-idx="${idx}"]`);
  const oldHtml = btn.html();

  try {
    btn.prop("disabled", true);
    btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');

    const mem = getChatMemory();
    const calData = mem?.calendar || DEFAULT_CALENDAR;

    const prompt = `
You are rewriting one calendar event.

CALENDAR MONTHS:
${calData.months.map(m => `- ${m.name} (${m.days} days)`).join("\n")}

CURRENT EVENT:
${JSON.stringify(baseEv, null, 2)}

RULES:
- Keep the same date unless it is invalid.
- Keep visibility unless there is a clear reason to change it.
- Improve title, description, tags, type, and priority if needed.
- Output JSON only.

SCHEMA:
{
  "event": {
    "day": number,
    "month": "MonthName",
    "year": number,
    "title": "Short title",
    "description": "Detailed description",
    "type": "story | social | random | weather | quest | character | world | event",
    "priority": "low | normal | high",
    "tags": ["tag1", "tag2"],
    "visibility": "public | hidden",
    "exposureEveryDays": number,
    "leadTimeDays": number
  }
}
`.trim();

    const prefill = "{\n  \"event\": {\n    \"day\": ";
    const resultText = await safeGenerateRaw(prompt, prefill);
    const parsed = parseAIResponseJSON(resultText);

    if (!parsed?.event) throw new Error("Bad event JSON");

    const e = parsed.event;

    getPendingAiEvents()[idx] = {
      ...baseEv,
      day: normalizeNumber(e.day, baseEv.day),
      month: String(e.month || baseEv.month || "").trim(),
      year: normalizeNumber(e.year, baseEv.year),
      title: String(e.title || baseEv.title || "").trim(),
      description: String(e.description || baseEv.description || "").trim(),
      type: String(e.type || baseEv.type || "event").trim().toLowerCase(),
      priority: String(e.priority || baseEv.priority || "normal").trim().toLowerCase(),
      tags: Array.isArray(e.tags)
        ? e.tags.map((t) => String(t).trim()).filter(Boolean)
        : (baseEv.tags || []),
      visibility: String(e.visibility || baseEv.visibility || "public").trim().toLowerCase(),
      exposureEveryDays: normalizeNumber(e.exposureEveryDays, baseEv.exposureEveryDays || 0),
      leadTimeDays: normalizeNumber(e.leadTimeDays, baseEv.leadTimeDays || 0),
    };
    setPendingAiEvents(getPendingAiEvents());

    showPreviewModal();
  } catch (err) {
    console.error("Single event regeneration failed:", err);
    toastr.error(t("failed_regenerate_event"));
  } finally {
    btn.prop("disabled", false);
    btn.html(oldHtml);
  }
}

function parseTagsInput(value) {
  return String(value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function isQuestLinkedCalendarEvent(e) {
  return Boolean(e?.relatedQuestId || e?.sourceQuestId || e?.type === "quest");
}

function saveEventsToCalendar() {
  const editedEvents = readAiPreviewEvents();
  const { addedCount, updatedCount } = commitCalendarEvents(editedEvents);

  $("#sm-events-preview-inline").hide();
  $("#sm-events-inline-panel").slideUp(150);
  setPendingAiEvents([]);

  toastr.success(
    t("saved_events_new_updated_x_y")
      .replace("{0}", String(addedCount))
      .replace("{1}", String(updatedCount)),
  );
}


  return {
    escapeAttr,
    getRangeFromUI,
    fillRangeMonthSelects,
    normalizeVisibilityMode,
    normalizeEventStyle,
    formatCalendarEventForContext,
    validateEvents,
    requestGeneratedEvents,
    showPreviewModal,
    regenerateSinglePreviewEvent,
    parseTagsInput,
    isQuestLinkedCalendarEvent,
    saveEventsToCalendar,
  };
}
