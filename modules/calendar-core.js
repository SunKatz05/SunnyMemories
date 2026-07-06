export const DEFAULT_CLASSIC_MONTHS = [
  { name: "January", days: 31 },
  { name: "February", days: 28 },
  { name: "March", days: 31 },
  { name: "April", days: 30 },
  { name: "May", days: 31 },
  { name: "June", days: 30 },
  { name: "July", days: 31 },
  { name: "August", days: 31 },
  { name: "September", days: 30 },
  { name: "October", days: 31 },
  { name: "November", days: 30 },
  { name: "December", days: 31 },
];

export const DEFAULT_CALENDAR = {
  mode: "classic",
  currentDate: { day: 1, month: "January", year: 1000 },
  months: [...DEFAULT_CLASSIC_MONTHS],
  events: [],
};

export function buildDateKey(year, month, day) {
  return `${year}-${month}-${day}`;
}

export function getAbsoluteDay(year, monthName, day, monthsConfig) {
  if (!monthsConfig || monthsConfig.length === 0) return 0;
  let yearDays = monthsConfig.reduce(
    (acc, m) => acc + (parseInt(m.days) || 30),
    0,
  );
  let total = (parseInt(year) || 0) * yearDays;
  let mIdx = monthsConfig.findIndex((m) => m.name === monthName);
  if (mIdx === -1) mIdx = 0;
  for (let i = 0; i < mIdx; i++) total += parseInt(monthsConfig[i].days) || 30;
  return total + (parseInt(day) || 1);
}

export function createCalendarCore({
  normalizeNumber,
  getChatMemory,
  setChatMemory,
  getAbsoluteChatLength,
  renderCalendar,
  scheduleContextUpdate,
} = {}) {
function getOrInitCalendar() {
  const mem = getChatMemory();

  if (!mem.calendar) {
    mem.calendar = JSON.parse(JSON.stringify(DEFAULT_CALENDAR));
    setChatMemory({ calendar: mem.calendar });
  }

  if (!Array.isArray(mem.calendar.months) || mem.calendar.months.length === 0) {
    mem.calendar.months = [...DEFAULT_CLASSIC_MONTHS];
  }

  if (!Array.isArray(mem.calendar.events)) {
    mem.calendar.events = [];
    setChatMemory({ calendar: mem.calendar });
  }

  if (!mem.calendar.currentDate || typeof mem.calendar.currentDate !== "object") {
    mem.calendar.currentDate = { day: 1, month: "January", year: 1000 };
    setChatMemory({ calendar: mem.calendar });
  }

  return mem.calendar;
}

function ensureCalendar(mem) {
  if (!mem.calendar) {
    mem.calendar = JSON.parse(JSON.stringify(DEFAULT_CALENDAR));
  }

  if (!mem.calendar.currentDate) {
    mem.calendar.currentDate = { day: 1, month: "January", year: 1000 };
  }

  if (!Array.isArray(mem.calendar.months) || mem.calendar.months.length === 0) {
    mem.calendar.months = [...DEFAULT_CLASSIC_MONTHS];
  }

  if (!Array.isArray(mem.calendar.events)) {
    mem.calendar.events = [];
  }

  return mem.calendar;
}

function applyAnchorDateToCalendar(mem, anchorDate) {
  if (!anchorDate) return false;

  const cal = ensureCalendar(mem);
  const nextDate = {
    day: normalizeNumber(anchorDate.day, cal.currentDate.day || 1),
    month: String(anchorDate.month || cal.currentDate.month || "January"),
    year: normalizeNumber(anchorDate.year, cal.currentDate.year || 1000),
  };

  const changed =
    cal.currentDate.day !== nextDate.day ||
    cal.currentDate.month !== nextDate.month ||
    cal.currentDate.year !== nextDate.year;

  cal.currentDate = nextDate;
  return changed;
}

function reconcileEventVisibility(cal) {
  if (!cal?.events?.length) return false;

  const currentAbs = getAbsoluteDay(
    cal.currentDate.year,
    cal.currentDate.month,
    cal.currentDate.day,
    cal.months,
  );

  let changed = false;

  for (const e of cal.events) {
    if (!e) continue;

    const evAbs = getAbsoluteDay(e.year, e.month, e.day, cal.months);
    const visibility = String(e.visibility || "public").toLowerCase().trim();
    const state = String(e.state || "").toLowerCase().trim();
    const revealAtAbs = Number.isFinite(Number(e.revealAtAbs))
      ? Number(e.revealAtAbs)
      : evAbs;

    if (e.revealAtAbs !== revealAtAbs) {
      e.revealAtAbs = revealAtAbs;
      changed = true;
    }

    if (visibility === "hidden" || visibility === "visible") {
      if (e.wasHidden !== true) {
        e.wasHidden = true;
        changed = true;
      }

      if (currentAbs >= revealAtAbs) {
        if (e.visibility !== "public") {
          e.visibility = "public";
          changed = true;
        }

        if (e.state !== "revealed") {
          e.state = "revealed";
          changed = true;
        }
      } else {
        if (e.visibility !== "hidden") {
          e.visibility = "hidden";
          changed = true;
        }

        if (e.state !== "hidden") {
          e.state = "hidden";
          changed = true;
        }
      }
    } else {
      if (e.visibility !== "public") {
        e.visibility = "public";
        changed = true;
      }

      if (e.state !== "revealed") {
        e.state = "revealed";
        changed = true;
      }
    }

    if (e.revealAtAbs == null && e.visibility === "public") {
      e.revealAtAbs = evAbs;
      changed = true;
    }

    if (e.retainDays == null) {
      e.retainDays = 30;
      changed = true;
    }
  }

  return changed;
}

function syncQuestToCalendar(quest, mem) {
  if (!mem.calendar) return;
  if (!mem.calendar.events) mem.calendar.events = [];

  const hasDate =
    quest.plannedDate &&
    quest.plannedDate.day &&
    quest.plannedDate.month &&
    quest.plannedDate.year;

  if (!hasDate) {
    mem.calendar.events = mem.calendar.events.filter(
      (e) => e.relatedQuestId !== quest.id,
    );
    return;
  }

  const existingEvent = mem.calendar.events.find(
    (e) => e.relatedQuestId === quest.id,
  );

  const eventPayload = stampCalendarMeta(
    {
      id: "e_" + Date.now() + Math.floor(Math.random() * 1000),
      day: quest.plannedDate.day,
      month: quest.plannedDate.month,
      year: quest.plannedDate.year,
      title: quest.title,
      description: quest.description || `[Quest] ${quest.title}`,
      type: "quest",
      questStatus: quest.status || "current",
      relatedQuestId: quest.id,
      sourceQuestId: quest.id,
      tags: Array.isArray(quest.tags) ? quest.tags : [],
      visibility: quest.visibility || "public",
      state: quest.visibility === "hidden" ? "hidden" : "revealed",
      wasHidden:
        existingEvent?.wasHidden === true ||
        String(quest.visibility || "public").toLowerCase().trim() === "hidden" ||
        String(quest.visibility || "public").toLowerCase().trim() === "visible",
      retainDays: quest.retainDays ?? 30,
    },
    {
      source: quest.source || "manual",
      dateSource: quest.dateSource || "manual",
      createdFrom: "quest-sync",
      sourceMessageId: quest.sourceMessageId ?? null,
    },
  );

  if (existingEvent) {
    Object.assign(existingEvent, eventPayload);
  } else {
    mem.calendar.events.push(eventPayload);
  }
}

function advanceCalendarByDays(cal, days = 1) {
  if (!cal || !Array.isArray(cal.months) || cal.months.length === 0) return false;
  if (!cal.currentDate) return false;

  let remaining = Math.max(0, normalizeNumber(days, 0));
  if (remaining === 0) return false;

  let changed = false;

  while (remaining > 0) {
    let mIdx = cal.months.findIndex((m) => m.name === cal.currentDate.month);
    if (mIdx === -1) mIdx = 0;

    const maxDays = parseInt(cal.months[mIdx].days) || 30;
    cal.currentDate.day++;
    changed = true;

    if (cal.currentDate.day > maxDays) {
      cal.currentDate.day = 1;
      mIdx++;
      if (mIdx >= cal.months.length) {
        mIdx = 0;
        cal.currentDate.year++;
      }
      cal.currentDate.month = cal.months[mIdx].name;
    }

    remaining--;
  }

  return changed;
}

function applyCalendarSignalToMemory(mem, signal) {
  if (!mem || !signal) return false;

  const cal = ensureCalendar(mem);
  const currentDate = cal?.currentDate || DEFAULT_CALENDAR.currentDate;
  const signalSignature =
    signal.mode === "setDate"
      ? `setDate:${signal.year}:${signal.month}:${signal.day}`
      : signal.mode === "advance"
        ? `advance:${normalizeNumber(signal.days, 0)}`
        : "unknown";

  const isSetDateAlreadyAppliedAndCurrent =
    signal.mode === "setDate" &&
    normalizeNumber(currentDate.day, 0) === normalizeNumber(signal.day, -1) &&
    String(currentDate.month || "") === String(signal.month || "") &&
    normalizeNumber(currentDate.year, 0) === normalizeNumber(signal.year, -1);

  if (
    signal.sourceMessageId !== null &&
    signal.sourceMessageId !== undefined &&
    cal.lastAppliedSignalMessageId === signal.sourceMessageId &&
    cal.lastAppliedSignalSignature === signalSignature &&
    (signal.mode !== "setDate" || isSetDateAlreadyAppliedAndCurrent)
  ) {
    return false;
  }

  let changed = false;

  if (signal.mode === "setDate") {
    changed = applyAnchorDateToCalendar(mem, signal);
  } else if (signal.mode === "advance") {
    changed = advanceCalendarByDays(cal, signal.days);
  }

  cal.lastAppliedSignalMessageId = signal.sourceMessageId;
  cal.lastAppliedSignalSignature = signalSignature;
  cal.revision = normalizeNumber(cal.revision, 0) + 1;

  return changed;
}

function stampCalendarMeta(item, meta = {}) {
  if (!item || typeof item !== "object") return item;

  item.source = meta.source || item.source || "manual";
  item.dateSource = meta.dateSource || item.dateSource || "manual";
  item.sourceMessageId =
    meta.sourceMessageId !== undefined ? meta.sourceMessageId : (item.sourceMessageId ?? null);
  item.createdFrom = meta.createdFrom || item.createdFrom || "manual-ui";
  item.updatedAt = Date.now();

  if (!item.id) {
    item.id = `${item.type || "item"}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }

  return item;
}

function touchCalendarRevision(mem) {
  if (!mem?.calendar) return false;
  mem.calendar.revision = normalizeNumber(mem.calendar.revision, 0) + 1;
  mem.calendar.lastUpdatedAt = Date.now();
  return true;
}

function refreshCalendarAfterDateChange(mem, cal, options = {}) {
  if (!cal) return false;

  const dateChanged = options?.dateChanged === true;
  const markManualOverride = options?.markManualOverride === true;
  const shouldRender = options?.render !== false;
  const shouldScheduleContext = options?.scheduleContext !== false;

  if (markManualOverride) {
    cal.manualDateOverrideMessageId = getAbsoluteChatLength() - 1;
  }

  const visibilityChanged = reconcileEventVisibility(cal);
  if (!dateChanged && !visibilityChanged) return false;

  if (mem && typeof mem === "object") {
    mem.calendar = cal;
    touchCalendarRevision(mem);
  }

  setChatMemory({ calendar: cal });

  if (shouldRender) {
    renderCalendar();
  }

  if (shouldScheduleContext) {
    scheduleContextUpdate();
  }

  return true;
}

function applyManualCalendarDateChange(cal, changed = true, previousDate = null) {
  if (!cal) return false;

  return refreshCalendarAfterDateChange(null, cal, {
    dateChanged: changed,
    markManualOverride: true,
  });
}

function advanceCalendarOneDayFromUi() {
  const mem = getChatMemory();
  const cal = ensureCalendar(mem);
  if (!cal) return false;

  const prevDate = {
    day: cal.currentDate.day,
    month: cal.currentDate.month,
    year: cal.currentDate.year,
  };
  const changed = advanceCalendarByDays(cal, 1);
  return applyManualCalendarDateChange(cal, changed, prevDate);
}

  return {
    getOrInitCalendar,
    ensureCalendar,
    applyAnchorDateToCalendar,
    reconcileEventVisibility,
    syncQuestToCalendar,
    advanceCalendarByDays,
    applyCalendarSignalToMemory,
    stampCalendarMeta,
    touchCalendarRevision,
    refreshCalendarAfterDateChange,
    applyManualCalendarDateChange,
    advanceCalendarOneDayFromUi,
  };
}
