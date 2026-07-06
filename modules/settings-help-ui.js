// Settings help popovers and mini-guide UI live together because both power the
// inline guidance controls inside the extension settings panel.
export function createHelpPopovers({ $, window, document } = {}) {
  function setDensityHelpOpen(isOpen) {
    const wrap = $("#sm-density-help-wrap");
    const btn = $("#sm-density-help-btn");
    if (!wrap.length || !btn.length) return;

    wrap.toggleClass("sm-open", isOpen);
    btn.attr("aria-expanded", isOpen ? "true" : "false");
  }

  function toggleDensityHelp(forceOpen = null) {
    const wrap = $("#sm-density-help-wrap");
    if (!wrap.length) return;

    const shouldOpen =
      forceOpen === null ? !wrap.hasClass("sm-open") : Boolean(forceOpen);
    setDensityHelpOpen(shouldOpen);
  }

  function setLibrarySymbolsHelpOpen(isOpen, targetWrap = null) {
    const wraps = targetWrap
      ? $(targetWrap)
      : $(".sm-library-symbols-help-wrap");
    if (!wraps.length) return;

    wraps.each(function () {
      const wrap = $(this);
      const btn = wrap.find(".sm-library-symbols-help-btn").first();
      wrap.toggleClass("sm-open", isOpen);
      if (btn.length) {
        btn.attr("aria-expanded", isOpen ? "true" : "false");
      }
    });
  }

  function toggleLibrarySymbolsHelp(forceOpen = null, targetWrap = null) {
    const wrap = targetWrap
      ? $(targetWrap).first()
      : $(".sm-library-symbols-help-wrap").first();
    if (!wrap.length) return;

    const shouldOpen =
      forceOpen === null ? !wrap.hasClass("sm-open") : Boolean(forceOpen);
    if (shouldOpen) {
      setLibrarySymbolsHelpOpen(false);
    }
    setLibrarySymbolsHelpOpen(shouldOpen, wrap);
  }

  function adjustLibrarySymbolsHelpPopoverPlacement(wrap) {
    const targetWrap = $(wrap).first();
    if (!targetWrap.length) return;

    const popover = targetWrap.find(".sm-library-symbols-help-popover").first();
    if (!popover.length) return;

    targetWrap.removeClass("sm-popover-left");

    const rect = popover[0].getBoundingClientRect();
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth || 0;
    const hasRightOverflow = rect.right > viewportWidth - 8;
    const hasLeftOverflow = rect.left < 8;

    if (hasRightOverflow && !hasLeftOverflow) {
      targetWrap.addClass("sm-popover-left");
      const leftRect = popover[0].getBoundingClientRect();
      if (leftRect.left < 8) {
        targetWrap.removeClass("sm-popover-left");
      }
    }
  }

  return {
    setDensityHelpOpen,
    toggleDensityHelp,
    setLibrarySymbolsHelpOpen,
    toggleLibrarySymbolsHelp,
    adjustLibrarySymbolsHelpPopoverPlacement,
  };
}

const MINI_GUIDE_VIEWS = {
  MAIN: "main",
  TOPICS: "topics",
  ARTICLE: "article",
};

export function createMiniGuideUi({ $ } = {}) {
  function setMiniGuideView(panel, view) {
    if (!panel || !panel.length) return;
    const safeView =
      view === MINI_GUIDE_VIEWS.TOPICS || view === MINI_GUIDE_VIEWS.ARTICLE
        ? view
        : MINI_GUIDE_VIEWS.MAIN;
    panel.attr("data-guide-view", safeView);
  }

  function normalizeMiniGuideState(panel) {
    if (!panel || !panel.length) return;

    const allMain = panel.find(".sm-mini-guide-main-btn");
    if (!allMain.length) return;

    let activeMain = allMain.filter(".is-active").first();
    if (!activeMain.length) {
      activeMain = allMain.first().addClass("is-active");
    }
    allMain.not(activeMain).removeClass("is-active");

    const requestedTab = String(activeMain.data("guide-tab") || "").trim();
    const allPanes = panel.find(".sm-mini-guide-pane");
    let targetPane = requestedTab
      ? allPanes.filter(`[data-guide-pane=\"${requestedTab}\"]`).first()
      : $();
    if (!targetPane.length) {
      targetPane = allPanes.first();
    }

    allPanes.removeClass("is-active").css("display", "none");
    if (!targetPane.length) return;
    targetPane.addClass("is-active").css("display", "block");

    allPanes.not(targetPane).find(".sm-mini-guide-subtab-btn").removeClass("is-active");
    allPanes.not(targetPane).find(".sm-mini-guide-subpane").removeClass("is-active");

    const allSubtabs = targetPane.find(".sm-mini-guide-subtab-btn");
    const allSubpanes = targetPane.find(".sm-mini-guide-subpane");
    if (!allSubtabs.length || !allSubpanes.length) return;

    let activeSubtab = allSubtabs.filter(".is-active").first();
    if (!activeSubtab.length) {
      activeSubtab = allSubtabs.first().addClass("is-active");
    }
    allSubtabs.not(activeSubtab).removeClass("is-active");

    const subtabKey = String(activeSubtab.data("guide-subtab") || "").trim();
    let targetSubpane = subtabKey
      ? allSubpanes.filter(`[data-guide-subpane=\"${subtabKey}\"]`).first()
      : $();
    if (!targetSubpane.length) {
      targetSubpane = allSubpanes.first();
    }

    allSubpanes.removeClass("is-active").css("display", "none");
    targetSubpane.addClass("is-active").css("display", "block");

    const currentView = String(panel.attr("data-guide-view") || "").trim();
    if (
      currentView !== MINI_GUIDE_VIEWS.MAIN &&
      currentView !== MINI_GUIDE_VIEWS.TOPICS &&
      currentView !== MINI_GUIDE_VIEWS.ARTICLE
    ) {
      setMiniGuideView(panel, MINI_GUIDE_VIEWS.MAIN);
    }
  }

  function bindMiniGuideHandlers() {
    $(document).off("click", "#sm-mini-guide-toggle");
    $(document).off("click", "#sm-mini-guide-panel .sm-mini-guide-main-btn");
    $(document).off("click", "#sm-mini-guide-panel .sm-mini-guide-subtab-btn");
    $(document).off("click", "#sm-mini-guide-panel [data-guide-back]");

    $(document).on("click", "#sm-mini-guide-toggle", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const panel = $("#sm-mini-guide-panel");
      if (!panel.length) return;
      const nextExpanded = !panel.is(":visible");
      if (nextExpanded) {
        normalizeMiniGuideState(panel);
        setMiniGuideView(panel, MINI_GUIDE_VIEWS.MAIN);
      }
      panel.stop(true, true).slideToggle(140);
      $(this).attr("aria-expanded", nextExpanded ? "true" : "false");
    });

    $(document).on("click", "#sm-mini-guide-panel .sm-mini-guide-main-btn", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const tab = String($(this).data("guide-tab") || "").trim();
      if (!tab) return;

      const panel = $("#sm-mini-guide-panel");
      if (!panel.length) return;

      panel.find(".sm-mini-guide-main-btn").removeClass("is-active");
      $(this).addClass("is-active");

      panel.find(".sm-mini-guide-pane").removeClass("is-active");
      const targetPane = panel
        .find(`.sm-mini-guide-pane[data-guide-pane=\"${tab}\"]`)
        .first();
      if (!targetPane.length) return;
      targetPane.addClass("is-active");

      targetPane.find(".sm-mini-guide-subtab-btn").removeClass("is-active");
      targetPane.find(".sm-mini-guide-subpane").removeClass("is-active");

      const firstSubtab = targetPane.find(".sm-mini-guide-subtab-btn").first();
      const firstSubpane = targetPane.find(".sm-mini-guide-subpane").first();
      if (firstSubtab.length) firstSubtab.addClass("is-active");
      if (firstSubpane.length) firstSubpane.addClass("is-active");

      normalizeMiniGuideState(panel);
      setMiniGuideView(panel, MINI_GUIDE_VIEWS.TOPICS);
    });

    $(document).on("click", "#sm-mini-guide-panel .sm-mini-guide-subtab-btn", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const subtab = String($(this).data("guide-subtab") || "").trim();
      if (!subtab) return;

      const pane = $("#sm-mini-guide-panel .sm-mini-guide-pane.is-active").first();
      if (!pane.length) return;

      pane.find(".sm-mini-guide-subtab-btn").removeClass("is-active");
      $(this).addClass("is-active");

      pane.find(".sm-mini-guide-subpane").removeClass("is-active");
      pane
        .find(`.sm-mini-guide-subpane[data-guide-subpane=\"${subtab}\"]`)
        .first()
        .addClass("is-active");

      const panel = $("#sm-mini-guide-panel");
      normalizeMiniGuideState(panel);
      setMiniGuideView(panel, MINI_GUIDE_VIEWS.ARTICLE);
    });

    $(document).on("click", "#sm-mini-guide-panel [data-guide-back]", function (e) {
      e.preventDefault();
      e.stopPropagation();

      const panel = $("#sm-mini-guide-panel");
      if (!panel.length) return;
      const target = String($(this).data("guide-back") || "").trim();

      normalizeMiniGuideState(panel);
      if (target === "auto") {
        const currentView = String(panel.attr("data-guide-view") || "").trim();
        if (currentView === MINI_GUIDE_VIEWS.ARTICLE) {
          setMiniGuideView(panel, MINI_GUIDE_VIEWS.TOPICS);
          return;
        }
        setMiniGuideView(panel, MINI_GUIDE_VIEWS.MAIN);
        return;
      }
      if (target === "topics") {
        setMiniGuideView(panel, MINI_GUIDE_VIEWS.TOPICS);
        return;
      }
      setMiniGuideView(panel, MINI_GUIDE_VIEWS.MAIN);
    });

    const miniGuidePanel = $("#sm-mini-guide-panel");
    normalizeMiniGuideState(miniGuidePanel);
    setMiniGuideView(miniGuidePanel, MINI_GUIDE_VIEWS.MAIN);
  }

  return {
    bindMiniGuideHandlers,
    normalizeMiniGuideState,
    setMiniGuideView,
  };
}
