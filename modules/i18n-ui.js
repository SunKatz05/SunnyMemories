export function createTranslationApplier({ $, t }) {
  function applyTranslations() {
  $("#sunny_memories_settings [data-i18n]").each(function () {
    const key = $(this).data("i18n");
    if ($(this).children("i").length > 0) {
      const icon = $(this).children("i")[0].outerHTML;
      $(this).html(icon + t(key));
    } else {
      $(this).text(t(key));
    }
  });

  $("#sunny_memories_settings [data-i18n-title]").each(function () {
    $(this).attr("title", t($(this).data("i18n-title")));
  });

  $("#sunny_memories_settings [data-i18n-placeholder]").each(function () {
    $(this).attr("placeholder", t($(this).data("i18n-placeholder")));
  });

  $("#sunny_memories_settings [data-i18n-aria-label]").each(function () {
    $(this).attr("aria-label", t($(this).data("i18n-aria-label")));
  });

  if ($("#sm-quest-form-type").length) {
    $('#sm-quest-form-type option[value="main"]').text(t("main_event"));
    $('#sm-quest-form-type option[value="side"]').text(t("side_obj"));
    $('#sm-quest-form-type option[value="short"]').text(t("short_task"));
    $('#sm-quest-form-status option[value="current"]').text(t("current"));
    $('#sm-quest-form-status option[value="future"]').text(t("future"));
    $('#sm-quest-form-status option[value="past"]').text(t("past"));
  }

  if ($("#sm-cal-mode").length) {
    $('#sm-cal-mode option[value="classic"]').text(t("classic_mode"));
    $('#sm-cal-mode option[value="custom"]').text(t("custom_mode"));
  }

  if ($("#sm-ev-param-style").length) {
    $('#sm-ev-param-style option[value="mixed"]').text(t("style_mixed"));
    $('#sm-ev-param-style option[value="story"]').text(t("style_story"));
    $('#sm-ev-param-style option[value="random"]').text(t("style_random"));
    $('#sm-ev-param-style option[value="social"]').text(t("style_social"));
    $('#sm-ev-param-style option[value="weather"]').text(t("style_weather"));
    $('#sm-ev-param-style option[value="character"]').text(t("style_character"));
    $('#sm-ev-param-style option[value="world"]').text(t("style_world"));
    $('#sm-ev-param-style option[value="quest"]').text(t("style_quest"));
  }

  if ($("#sm-ev-param-density").length) {
    $('#sm-ev-param-density option[value="low"]').text(t("density_low"));
    $('#sm-ev-param-density option[value="medium"]').text(t("density_medium"));
    $('#sm-ev-param-density option[value="high"]').text(t("density_high"));
  }

  if ($("#sm-ev-param-visibility").length) {
    $('#sm-ev-param-visibility option[value="mixed"]').text(t("visibility_mixed"));
    $('#sm-ev-param-visibility option[value="public"]').text(t("public"));
    $('#sm-ev-param-visibility option[value="hidden"]').text(t("hidden"));
  }

  if ($("#sm-event-range-mode").length) {
    $('#sm-event-range-mode option[value="last"]').text(t("range_last_n"));
    $('#sm-event-range-mode option[value="first"]').text(t("range_first_n"));
    $('#sm-event-range-mode option[value="all"]').text(t("range_all_visible"));
  }

  if ($("#sm-event-auto-range-mode").length) {
    $('#sm-event-auto-range-mode option[value="last"]').text(t("range_last_n"));
    $('#sm-event-auto-range-mode option[value="first"]').text(t("range_first_n"));
    $('#sm-event-auto-range-mode option[value="all"]').text(t("range_all_visible"));
  }

  $(
    '#sunny-memories-summary-role option[value="0"], #sunny-memories-facts-role option[value="0"]',
  ).text(t("sys"));
  $(
    '#sunny-memories-summary-role option[value="1"], #sunny-memories-facts-role option[value="1"]',
  ).text(t("usr"));
  $(
    '#sunny-memories-summary-role option[value="2"], #sunny-memories-facts-role option[value="2"]',
  ).text(t("ast"));
}


  return applyTranslations;
}
