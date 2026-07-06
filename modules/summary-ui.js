export function createSummaryUi({
  $,
  extension_settings,
  extensionName,
  SUMMARY_MODE_DYNAMIC,
  SUMMARY_MODE_STATIC,
  normalizeSummaryMode,
} = {}) {
  function getSelectedSummaryMode() {
    const selectedValue = $('input[name="sm_summary_mode"]:checked').val();
    return normalizeSummaryMode(selectedValue);
  }

  function setSelectedSummaryMode(mode) {
    const normalizedMode = normalizeSummaryMode(mode);
    $("#sm-summary-mode-dynamic").prop(
      "checked",
      normalizedMode === SUMMARY_MODE_DYNAMIC,
    );
    $("#sm-summary-mode-static").prop(
      "checked",
      normalizedMode === SUMMARY_MODE_STATIC,
    );
  }

  function toggleSummaryModeSettingsVisibility() {
    const selectedMode = getSelectedSummaryMode();
    $("#sm-summary-static-settings").toggle(selectedMode === SUMMARY_MODE_STATIC);
  }

  function setSummaryModeHelpOpen(isOpen) {
    const wrap = $("#sm-summary-mode-help-wrap");
    const btn = $("#sm-summary-mode-help-btn");
    if (!wrap.length || !btn.length) return;

    wrap.toggleClass("sm-open", isOpen);
    btn.attr("aria-expanded", isOpen ? "true" : "false");
  }

  function toggleSummaryModeHelp(forceOpen = null) {
    const wrap = $("#sm-summary-mode-help-wrap");
    if (!wrap.length) return;

    const shouldOpen =
      forceOpen === null ? !wrap.hasClass("sm-open") : Boolean(forceOpen);
    setSummaryModeHelpOpen(shouldOpen);
  }

  function setSummaryInjectWarningOpen(isOpen) {
    const modal = $("#sm-summary-inject-warning-modal");
    if (!modal.length) return;

    modal.toggleClass("sm-open", isOpen);
    modal.attr("aria-hidden", isOpen ? "false" : "true");
  }

  function maybeShowSummaryInjectWarning() {
    if (!extension_settings[extensionName]) {
      extension_settings[extensionName] = {};
    }

    const s = extension_settings[extensionName];
    if (s.summaryInjectWarningDismissed === true) return;

    $("#sm-summary-inject-warning-dismiss").prop("checked", false);
    setSummaryInjectWarningOpen(true);
  }

  return {
    toggleSummaryModeSettingsVisibility,
    setSummaryModeHelpOpen,
    toggleSummaryModeHelp,
    setSummaryInjectWarningOpen,
    maybeShowSummaryInjectWarning,
    getSelectedSummaryMode,
    setSelectedSummaryMode,
  };
}
