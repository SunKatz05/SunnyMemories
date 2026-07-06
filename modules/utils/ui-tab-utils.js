import { extension_settings } from "../../../../../extensions.js";

const $ = /** @type {any} */ ((/** @type {any} */ (globalThis)).$);
const extensionName = "SunnyMemories";

export function normalizeMainTab(tab) {
  const v = String(tab || "").toLowerCase().trim();
  return ["memories", "calendar", "album"].includes(v) ? v : "memories";
}

export function normalizeMemoriesTab(tab) {
  const v = String(tab || "").toLowerCase().trim();
  return ["summary", "facts", "library"].includes(v) ? v : "summary";
}

export function getMemoriesGenRangePanel($memoriesPane) {
  if (!$memoriesPane || !$memoriesPane.length) return $();

  let panel = $memoriesPane.data("smGenRangePanel");
  if (panel && panel.length) return panel;

  panel = $memoriesPane.find(".sm-memories-gen-range-panel").first();
  if (panel.length) {
    $memoriesPane.data("smGenRangePanel", panel);
  }
  return panel;
}

export function updateMemoriesGenRangePanelPlacement($memoriesPane, memTab) {
  if (!$memoriesPane || !$memoriesPane.length) return;

  const panel = getMemoriesGenRangePanel($memoriesPane);
  if (!panel.length) return;

  const tab = normalizeMemoriesTab(memTab);
  if (tab === "library") {
    panel.addClass("is-hidden").detach();
    return;
  }

  const host = $memoriesPane.find(`#sm-tab-${tab}`).first();
  if (!host.length) {
    panel.addClass("is-hidden").detach();
    return;
  }

  panel.removeClass("is-hidden").appendTo(host);
}

export function normalizeCalendarTab(tab) {
  const v = String(tab || "").toLowerCase().trim();
  return ["quests", "cal", "qcsettings"].includes(v) ? v : "quests";
}

const CALENDAR_SUBTAB_IDS = ["quests", "cal", "qcsettings"];

export function ensureCalendarSubtabPanes($calendarPane) {
  if (!$calendarPane || !$calendarPane.length) return;

  const $settingsRoot = $calendarPane.closest("#sunny_memories_settings");
  const $mount = $calendarPane.children(".sm-calendar-subtab-panes").first();
  const $target = $mount.length ? $mount : $calendarPane;

  CALENDAR_SUBTAB_IDS.forEach((tab) => {
    const selector = `#sm-tab-${tab}`;
    let $pane = $calendarPane.find(selector).first();
    if (!$pane.length && $settingsRoot.length) {
      $pane = $settingsRoot.find(selector).first();
    }
    if ($pane.length && !$pane.parent().is($target)) {
      $pane.appendTo($target);
    }
  });
}

export function activateSubTabPane($mainPane, tabName) {
  if (!$mainPane || !$mainPane.length) return false;

  const tab = String(tabName || "").trim();
  if (!tab) return false;

  const isCalendar = $mainPane.attr("id") === "sm-main-tab-calendar";
  if (isCalendar) ensureCalendarSubtabPanes($mainPane);

  const $mount = isCalendar
    ? $mainPane.children(".sm-calendar-subtab-panes").first()
    : $();
  const $paneScope = $mount.length ? $mount : $mainPane;

  $mainPane.find(".sm-tab-btn").removeClass("active");
  $paneScope.find(".sm-tab-pane").removeClass("active");
  $mainPane.find(`.sm-tab-btn[data-tab="${tab}"]`).first().addClass("active");

  let $pane = $paneScope.find(`#sm-tab-${tab}`).first();
  if (!$pane.length) {
    $pane = $mainPane.find(`#sm-tab-${tab}`).first();
  }
  if (!$pane.length) {
    const $settingsRoot = $mainPane.closest("#sunny_memories_settings");
    if ($settingsRoot.length) {
      $pane = $settingsRoot.find(`#sm-tab-${tab}`).first();
      if ($pane.length && isCalendar) {
        const $target = $mount.length ? $mount : $mainPane;
        $pane.appendTo($target);
      }
    }
  }

  if (!$pane.length) return false;

  $pane.addClass("active");
  return true;
}

export function applyVisibilityToggles() {
  const s = extension_settings[extensionName] || {};
  const modMem = s.enableModuleMemories !== false;
  const modQst = s.enableModuleQuests !== false;
  const modAlb = s.enableModuleAlbum !== false;
  const allowedMainTabs = [];
  if (modMem) allowedMainTabs.push("memories");
  if (modQst) allowedMainTabs.push("calendar");
  if (modAlb) allowedMainTabs.push("album");

  const roots = $("#sunny_memories_settings");
  if (!roots.length) return;

  roots.each(function () {
    const $root = $(this);

    $root.find("#sm-main-btn-memories").toggle(modMem);
    $root.find("#sm-main-btn-calendar").toggle(modQst);
    $root.find("#sm-main-btn-album").toggle(modAlb);

    if (allowedMainTabs.length > 0) {
      let nextMainKey = normalizeMainTab(
        String($root.find(".sm-main-tab-btn.active").data("maintab") || s.lastMainTab),
      );
      if (!allowedMainTabs.includes(nextMainKey)) {
        nextMainKey = allowedMainTabs[0];
      }

      $root.find(".sm-main-tab-btn").removeClass("active");
      $root.find(".sm-main-tab-pane").removeClass("active");
      $root.find(`.sm-main-tab-btn[data-maintab="${nextMainKey}"]`).first().addClass("active");
      $root.find(`#sm-main-tab-${nextMainKey}`).first().addClass("active");
    }

    $root.find("#sm-tab-btn-summary").toggle(modMem && s.enableTabSummary !== false);
    $root.find("#sm-tab-btn-facts").toggle(modMem && s.enableTabFacts !== false);
    $root.find("#sm-tab-btn-library").toggle(modMem && s.enableTabLibrary !== false);

    $root.find("#sm-tab-btn-quests").toggle(modQst && s.enableTabQuests !== false);
    $root.find("#sm-tab-btn-calendar").toggle(modQst && s.enableTabCalendar !== false);
    $root.find("#sm-tab-btn-qcsettings").toggle(modQst && s.enableTabQcSettings !== false);

    const memoriesPane = $root.find("#sm-main-tab-memories");
    const allowedMemoriesTabs = [];
    if (modMem && s.enableTabSummary !== false) allowedMemoriesTabs.push("summary");
    if (modMem && s.enableTabFacts !== false) allowedMemoriesTabs.push("facts");
    if (modMem && s.enableTabLibrary !== false) allowedMemoriesTabs.push("library");
    if (memoriesPane.length && allowedMemoriesTabs.length > 0) {
      let nextMemTab = normalizeMemoriesTab(
        String(memoriesPane.find(".sm-tab-btn.active").data("tab") || s.lastMemoriesTab),
      );
      if (!allowedMemoriesTabs.includes(nextMemTab)) {
        nextMemTab = allowedMemoriesTabs[0];
      }
      activateSubTabPane(memoriesPane, nextMemTab);
      updateMemoriesGenRangePanelPlacement(memoriesPane, nextMemTab);
    }

    const calendarPane = $root.find("#sm-main-tab-calendar");
    const allowedCalendarTabs = [];
    if (modQst && s.enableTabQuests !== false) allowedCalendarTabs.push("quests");
    if (modQst && s.enableTabCalendar !== false) allowedCalendarTabs.push("cal");
    if (modQst && s.enableTabQcSettings !== false) allowedCalendarTabs.push("qcsettings");
    if (calendarPane.length && allowedCalendarTabs.length > 0) {
      let nextCalTab = normalizeCalendarTab(
        String(calendarPane.find(".sm-tab-btn.active").data("tab") || s.lastCalendarTab),
      );
      if (!allowedCalendarTabs.includes(nextCalTab)) {
        nextCalTab = allowedCalendarTabs[0];
      }
      activateSubTabPane(calendarPane, nextCalTab);
    }
  });
}
