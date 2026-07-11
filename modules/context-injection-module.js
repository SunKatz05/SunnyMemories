import { compressQuestNotes } from "./utils/runtime-profile-text-utils.js";
import {
  buildContextInjectionSignature,
  canonicalizeSignatureText,
  clearContextInjectionAnchor,
  getAnchoredPromptDepth,
  getContextInjectionAnchors,
  shouldInjectContextBlock,
  shouldInjectPeriodicContextBlock,
  shouldRefreshContextAnchor,
} from "./utils/context-anchor-utils.js";

export function createContextInjectionModule({
  extension_settings,
  extensionName,
  setExtensionPrompt,
  getContext,
  getChatMemory,
  setChatMemory,
  getAbsoluteChatLength,
  isMessageHidden,
  isMessageSystem,
  syncCalendarStateFromChat,
  renderCalendar,
  getSummaryTextForInjection,
  normalizeSummaryMode,
  getSummaryStaticKeepLatestSetting,
  normInt,
  shouldInjectCalendarEvent,
  getAbsoluteDay,
} = {}) {
  let contextUpdateTimer;

  function isCountableUserTurnMessage(message) {
    if (!message || typeof message !== "object") return false;
    if (isMessageHidden(message) || isMessageSystem(message)) return false;

    const msgType = String(message.extra?.type || "").toLowerCase();
    if (msgType === "system" || msgType === "service") return false;
    if (message.extra?.is_system_block === true) return false;

    return message.is_user === true;
  }

  function getUserTurnCount(upToMessageId = null) {
    const ctx = getContext();
    if (!Array.isArray(ctx?.chat) || ctx.chat.length === 0) return 0;

    let endIndex = ctx.chat.length - 1;
    if (upToMessageId !== null && upToMessageId !== undefined) {
      const parsed = Number(upToMessageId);
      if (Number.isFinite(parsed)) {
        endIndex = Math.min(ctx.chat.length - 1, Math.max(-1, Math.floor(parsed)));
      }
    }

    if (endIndex < 0) return 0;

    let count = 0;
    for (let i = 0; i <= endIndex; i++) {
      if (isCountableUserTurnMessage(ctx.chat[i])) count++;
    }
    return count;
  }

  function getSafeText(value) {
    return typeof value === "string" ? value : String(value ?? "");
  }

  function formatLibraryMemoryForInjection(itemType, itemContent) {
    const normalizedType = getSafeText(itemType || "facts").trim().toLowerCase();
    const content = getSafeText(itemContent).trim();

    if (normalizedType === "summary") {
      return `<story_summary>\n${content}\n</story_summary>\n`;
    }

    return `<established_facts>\n${content}\n</established_facts>\n`;
  }

  function updateContextInjection() {
    try {
      return updateContextInjectionUnsafe();
    } catch (error) {
      console.warn("SunnyMemories: context injection update failed", error);
    }
  }

  function updateContextInjectionUnsafe() {
    const s = extension_settings[extensionName] || {};
    const mem = getChatMemory();
    const chatLength = getAbsoluteChatLength();
    const userTurnCount = getUserTurnCount(chatLength - 1);
    const hasChatMessages = chatLength > 0;
    const scanWI = s.scanWI !== false;
    const anchors = getContextInjectionAnchors(mem);
    let anchorsChanged = false;

    const calendarChanged = syncCalendarStateFromChat(mem, chatLength - 1);
    if (calendarChanged) {
      renderCalendar();
    }

    const modMem = s.enableModuleMemories !== false;
    const modQst = s.enableModuleQuests !== false;

    if (!modMem) {
      setExtensionPrompt(extensionName + "-summary", "", 0, 0, false, 0);
      setExtensionPrompt(extensionName + "-facts", "", 0, 0, false, 0);
      anchorsChanged = clearContextInjectionAnchor(anchors, "summary") || anchorsChanged;
      anchorsChanged = clearContextInjectionAnchor(anchors, "facts") || anchorsChanged;

      if (!s._activeLibPrompts) s._activeLibPrompts = {};
      for (const id of Object.keys(s._activeLibPrompts)) {
        setExtensionPrompt(`${extensionName}-lib-${id}`, "", 0, 0, false, 0);
      }
      s._activeLibPrompts = {};
    } else {
      const summaryText = getSummaryTextForInjection(mem, s);
      const sumFreq = Math.max(0, normInt(s.summaryFreq, 1));
      const summaryEnabled =
        s.enableSummary !== false &&
        summaryText.trim() !== "" &&
        s.summaryPosition != -1 &&
        sumFreq > 0;

      if (summaryEnabled) {
        const summarySignature = buildContextInjectionSignature([
          summaryText,
          normalizeSummaryMode(s.summaryMode),
          getSummaryStaticKeepLatestSetting(s),
          normInt(s.summaryPosition, 0),
          normInt(s.summaryDepth, 0),
          normInt(s.summaryRole, 0),
          scanWI ? 1 : 0,
        ]);
        const refreshSummaryAnchor = shouldRefreshContextAnchor({
          anchors,
          key: "summary",
          chatLength,
          timelineValue: chatLength,
          frequency: sumFreq,
          signature: summarySignature,
          driftThreshold: 20,
        });

        if (refreshSummaryAnchor) {
          anchorsChanged = true;
        }
        const summaryInjectState = shouldInjectContextBlock({
          anchors,
          key: "summary",
          chatLength,
          timelineValue: chatLength,
          frequency: sumFreq,
          signature: summarySignature,
        });
        anchorsChanged = summaryInjectState.stateChanged || anchorsChanged;
        const summaryDepth = getAnchoredPromptDepth({
          anchors,
          key: "summary",
          chatLength,
          timelineValue: chatLength,
          baseDepth: normInt(s.summaryDepth, 0),
        });

        setExtensionPrompt(
          extensionName + "-summary",
          `<story_summary>\n${summaryText.trim()}\n</story_summary>\n`,
          normInt(s.summaryPosition, 0),
          summaryDepth,
          scanWI,
          normInt(s.summaryRole, 0),
        );
      } else {
        setExtensionPrompt(extensionName + "-summary", "", 0, 0, false, 0);
        anchorsChanged = clearContextInjectionAnchor(anchors, "summary") || anchorsChanged;
      }

      const factsText = mem.facts || "";
      const factsFreq = Math.max(0, normInt(s.factsFreq, 1));
      const factsEnabled =
        s.enableFacts !== false &&
        factsText.trim() !== "" &&
        s.factsPosition != -1 &&
        hasChatMessages &&
        factsFreq > 0;

      if (factsEnabled) {
        const factsSignature = buildContextInjectionSignature([
          canonicalizeSignatureText(factsText),
          normInt(s.factsPosition, 1),
          normInt(s.factsDepth, 4),
          normInt(s.factsRole, 0),
          scanWI ? 1 : 0,
        ]);
        const refreshFactsAnchor = shouldRefreshContextAnchor({
          anchors,
          key: "facts",
          chatLength,
          timelineValue: userTurnCount,
          frequency: factsFreq,
          signature: factsSignature,
          driftThreshold: 24,
        });

        if (refreshFactsAnchor) {
          anchorsChanged = true;
        }
        const factsInjectState = shouldInjectPeriodicContextBlock({
          anchors,
          key: "facts",
          chatLength,
          userTurnCount,
          frequency: factsFreq,
          signature: factsSignature,
        });
        anchorsChanged = factsInjectState.stateChanged || anchorsChanged;
        const factsDepth = getAnchoredPromptDepth({
          anchors,
          key: "facts",
          chatLength,
          timelineValue: userTurnCount,
          baseDepth: normInt(s.factsDepth, 4),
        });

        if (factsInjectState.shouldInject) {
          setExtensionPrompt(
            extensionName + "-facts",
            `<established_facts>\n${factsText.trim()}\n</established_facts>\n`,
            normInt(s.factsPosition, 1),
            factsDepth,
            scanWI,
            normInt(s.factsRole, 0),
          );
        } else {
          setExtensionPrompt(extensionName + "-facts", "", 0, 0, false, 0);
        }
      } else {
        setExtensionPrompt(extensionName + "-facts", "", 0, 0, false, 0);
        anchorsChanged = clearContextInjectionAnchor(anchors, "facts") || anchorsChanged;
      }

      const prevActiveLibPrompts = s._activeLibPrompts || {};
      const nextActiveLibPrompts = {};

      (Array.isArray(mem.library) ? mem.library : []).forEach((item, index) => {
        const safeItem = item && typeof item === "object" ? item : {};
        const itemId = getSafeText(safeItem.id || `idx-${index}`);
        const itemContent = getSafeText(safeItem.content).trim();
        const itemType = getSafeText(safeItem.type || "facts");
        const libPromptKey = `${extensionName}-lib-${itemId}`;
        const anchorKey = `lib-${itemId}`;
        const itemFreq = Math.max(0, normInt(safeItem.frequency, 1));
        const itemEnabled =
          safeItem.enabled &&
          itemFreq > 0 &&
          hasChatMessages &&
          itemContent !== "" &&
          safeItem.position != -1;

        if (itemEnabled) {
          nextActiveLibPrompts[itemId] = true;
          const itemSignature = buildContextInjectionSignature([
            canonicalizeSignatureText(itemContent),
            itemType,
            normInt(safeItem.position, 0),
            normInt(safeItem.depth, 0),
            normInt(safeItem.role, 0),
            scanWI ? 1 : 0,
          ]);
          const refreshLibAnchor = shouldRefreshContextAnchor({
            anchors,
            key: anchorKey,
            chatLength,
            timelineValue: userTurnCount,
            frequency: itemFreq,
            signature: itemSignature,
            driftThreshold: 18,
          });

          if (refreshLibAnchor) {
            anchorsChanged = true;
          }
          const libInjectState = shouldInjectPeriodicContextBlock({
            anchors,
            key: anchorKey,
            chatLength,
            userTurnCount,
            frequency: itemFreq,
            signature: itemSignature,
          });
          anchorsChanged = libInjectState.stateChanged || anchorsChanged;
          const libDepth = getAnchoredPromptDepth({
            anchors,
            key: anchorKey,
            chatLength,
            timelineValue: userTurnCount,
            baseDepth: normInt(safeItem.depth, 0),
          });

          if (libInjectState.shouldInject) {
            setExtensionPrompt(
              libPromptKey,
              formatLibraryMemoryForInjection(itemType, itemContent),
              normInt(safeItem.position, 0),
              libDepth,
              scanWI,
              normInt(safeItem.role, 0),
            );
          } else {
            setExtensionPrompt(libPromptKey, "", 0, 0, false, 0);
          }
        } else {
          setExtensionPrompt(libPromptKey, "", 0, 0, false, 0);
          anchorsChanged = clearContextInjectionAnchor(anchors, anchorKey) || anchorsChanged;
        }
      });

      for (const id of Object.keys(prevActiveLibPrompts)) {
        if (nextActiveLibPrompts[id]) continue;
        setExtensionPrompt(`${extensionName}-lib-${id}`, "", 0, 0, false, 0);
        anchorsChanged = clearContextInjectionAnchor(anchors, `lib-${id}`) || anchorsChanged;
      }

      s._activeLibPrompts = nextActiveLibPrompts;
    }

    if (!modQst) {
      setExtensionPrompt(extensionName + "-quests", "", 0, 0, false, 0);
      setExtensionPrompt(extensionName + "-calendar-date", "", 0, 0, false, 0);
      setExtensionPrompt(extensionName + "-calendar-events", "", 0, 0, false, 0);
      anchorsChanged = clearContextInjectionAnchor(anchors, "quests") || anchorsChanged;
      anchorsChanged = clearContextInjectionAnchor(anchors, "calendar-events") || anchorsChanged;
    } else {
      const enableQ = s.qcEnableQuests !== false;
      const questFreq = Math.max(0, normInt(s.qcQuestFreq, 1));

      if (
        enableQ &&
        Array.isArray(mem.quests) &&
        mem.quests.length > 0 &&
        s.qcQuestPosition != -1 &&
        hasChatMessages &&
        questFreq > 0
      ) {
        const active = mem.quests.filter(
          (q) => q.status === "current" || q.status === "future",
        );
        const source = active.length > 0 ? active : mem.quests;

        const main = source.filter((q) => q.type === "main");
        const side = source.filter((q) => q.type === "side");
        const short = source.filter((q) => q.type === "short");
        const selected = [...main, ...side, ...short].slice(0, 5);

        if (selected.length > 0) {
          let qStr = `<active_quests>\n`;
          const renderQ = (q) =>
            `вЂў ${q.title}${q.plannedDate ? `[Day ${q.plannedDate.day} ${q.plannedDate.month}]` : ""}\n`;

          if (main.length > 0) {
            qStr += `Main:\n`;
            main.forEach((q) => (qStr += renderQ(q)));
          }
          if (side.length > 0) {
            qStr += `Side:\n`;
            side.forEach((q) => (qStr += renderQ(q)));
          }
          if (short.length > 0) {
            qStr += `Tasks:\n`;
            short.forEach((q) => (qStr += renderQ(q)));
          }

          qStr += `</active_quests>\n`;

          const notesBlock = selected
            .map((q) => {
              const triggers = compressQuestNotes(q.notes);
              return triggers ? `вЂў ${q.title}: ${triggers}\n` : "";
            })
            .filter(Boolean)
            .join("");

          if (notesBlock) {
            qStr += `<quest_notes>\n${notesBlock}</quest_notes>\n`;
          }

          const questSignature = buildContextInjectionSignature([
            qStr,
            normInt(s.qcQuestPosition, 1),
            normInt(s.qcQuestDepth, 2),
            scanWI ? 1 : 0,
          ]);
          const refreshQuestAnchor = shouldRefreshContextAnchor({
            anchors,
            key: "quests",
            chatLength,
            timelineValue: userTurnCount,
            frequency: questFreq,
            signature: questSignature,
            driftThreshold: 16,
          });

          if (refreshQuestAnchor) {
            anchorsChanged = true;
          }
          const questInjectState = shouldInjectPeriodicContextBlock({
            anchors,
            key: "quests",
            chatLength,
            userTurnCount,
            frequency: questFreq,
            signature: questSignature,
          });
          anchorsChanged = questInjectState.stateChanged || anchorsChanged;
          const questDepth = getAnchoredPromptDepth({
            anchors,
            key: "quests",
            chatLength,
            timelineValue: userTurnCount,
            baseDepth: normInt(s.qcQuestDepth, 2),
          });

          if (questInjectState.shouldInject) {
            setExtensionPrompt(
              extensionName + "-quests",
              qStr,
              normInt(s.qcQuestPosition, 1),
              questDepth,
              scanWI,
              0,
            );
          } else {
            setExtensionPrompt(extensionName + "-quests", "", 0, 0, false, 0);
          }
        } else {
          setExtensionPrompt(extensionName + "-quests", "", 0, 0, false, 0);
          anchorsChanged = clearContextInjectionAnchor(anchors, "quests") || anchorsChanged;
        }
      } else {
        setExtensionPrompt(extensionName + "-quests", "", 0, 0, false, 0);
        anchorsChanged = clearContextInjectionAnchor(anchors, "quests") || anchorsChanged;
      }

      const enableCalDate = s.qcEnableCalDate !== false;
      const enableCalEvents = s.qcEnableCalEvents !== false;
      let calDateStr = "";
      let calEventsStr = "";

      if (mem.calendar) {
        const cal = mem.calendar;

        if (enableCalDate) {
          calDateStr = `[System Note: The current in-world date is Day ${cal.currentDate.day} of ${cal.currentDate.month}, Year ${cal.currentDate.year}]\n`;
        }

        if (enableCalEvents) {
          const currentAbs = getAbsoluteDay(
            cal.currentDate.year,
            cal.currentDate.month,
            cal.currentDate.day,
            cal.months,
          );

          const upcoming = (cal.events || [])
            .map((e) => ({
              e,
              evAbs: getAbsoluteDay(e.year, e.month, e.day, cal.months),
            }))
            .filter(({ e, evAbs }) => shouldInjectCalendarEvent(e, evAbs, currentAbs))
            .sort((a, b) => a.evAbs - b.evAbs)
            .slice(0, 3);

          if (upcoming.length > 0) {
            calEventsStr += `Upcoming Events:\n`;
            upcoming.forEach(({ e }) => {
              const title = String(e.title || e.description || "Event");
              const extra = [];
              if (e.type) extra.push(e.type);
              if (e.priority) extra.push(e.priority);
              if (e.visibility) extra.push(e.visibility);

              calEventsStr += `вЂў Day ${e.day} ${e.month} вЂ” ${title}`;
              if (extra.length) calEventsStr += ` [${extra.join(", ")}]`;
              calEventsStr += `\n`;

              if (e.description && e.description !== title) {
                calEventsStr += `  ${e.description}\n`;
              }
            });
          }
        }

        const eventFreq = Math.max(0, normInt(s.qcEventFreq, 1));

        if (calDateStr && s.qcCalPosition != -1) {
          setExtensionPrompt(
            extensionName + "-calendar-date",
            calDateStr,
            normInt(s.qcCalPosition, 0),
            0,
            scanWI,
            0,
          );
        } else {
          setExtensionPrompt(extensionName + "-calendar-date", "", 0, 0, false, 0);
        }

        if (calEventsStr && s.qcEventPosition != -1 && eventFreq > 0) {
          const monthOrder = new Map(
            (cal.months || []).map((m, index) => [String(m?.name || ""), index]),
          );
          const eventSignatureEvents = (cal.events || [])
            .map((e) => ({
              id: e.id || "",
              day: normInt(e.day, 0),
              month: String(e.month || ""),
              year: normInt(e.year, 0),
              title: String(e.title || ""),
              description: String(e.description || ""),
              type: String(e.type || ""),
              priority: String(e.priority || ""),
              visibility: String(e.visibility || ""),
              state: String(e.state || ""),
            }))
            .sort((a, b) => {
              if (a.year !== b.year) return a.year - b.year;
              const aMonthOrder = monthOrder.has(a.month)
                ? monthOrder.get(a.month)
                : Number.MAX_SAFE_INTEGER;
              const bMonthOrder = monthOrder.has(b.month)
                ? monthOrder.get(b.month)
                : Number.MAX_SAFE_INTEGER;
              if (aMonthOrder !== bMonthOrder) return aMonthOrder - bMonthOrder;
              if (a.day !== b.day) return a.day - b.day;
              return String(a.id).localeCompare(String(b.id));
            });

          const eventSignature = buildContextInjectionSignature([
            JSON.stringify(eventSignatureEvents),
            normInt(cal.currentDate.day, 0),
            String(cal.currentDate.month || ""),
            normInt(cal.currentDate.year, 0),
            normInt(s.qcEventPosition, 0),
            normInt(s.qcEventDepth, 3),
            scanWI ? 1 : 0,
          ]);
          const refreshEventAnchor = shouldRefreshContextAnchor({
            anchors,
            key: "calendar-events",
            chatLength,
            timelineValue: userTurnCount,
            frequency: eventFreq,
            signature: eventSignature,
            driftThreshold: 14,
            useSignatureTrigger: false,
          });

          if (refreshEventAnchor) {
            anchorsChanged = true;
          }
          const calendarEventsInjectState = shouldInjectPeriodicContextBlock({
            anchors,
            key: "calendar-events",
            chatLength,
            userTurnCount,
            frequency: eventFreq,
            signature: eventSignature,
          });
          anchorsChanged = calendarEventsInjectState.stateChanged || anchorsChanged;
          const calendarEventsDepth = getAnchoredPromptDepth({
            anchors,
            key: "calendar-events",
            chatLength,
            timelineValue: userTurnCount,
            baseDepth: normInt(s.qcEventDepth, 3),
          });

          if (calendarEventsInjectState.shouldInject) {
            setExtensionPrompt(
              extensionName + "-calendar-events",
              calEventsStr,
              normInt(s.qcEventPosition, 0),
              calendarEventsDepth,
              scanWI,
              0,
            );
          } else {
            setExtensionPrompt(extensionName + "-calendar-events", "", 0, 0, false, 0);
          }
        } else {
          setExtensionPrompt(extensionName + "-calendar-events", "", 0, 0, false, 0);
          anchorsChanged = clearContextInjectionAnchor(anchors, "calendar-events") || anchorsChanged;
        }
      }
    }

    if (anchorsChanged) {
      setChatMemory({ _contextInjectionAnchors: anchors });
    }
  }


  function scheduleContextUpdate() {
    clearTimeout(contextUpdateTimer);
    contextUpdateTimer = setTimeout(() => {
      updateContextInjection();
    }, 500);
  }

  return {
    updateContextInjection,
    scheduleContextUpdate,
  };
}
