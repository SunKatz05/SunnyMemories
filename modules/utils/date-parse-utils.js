import { normalizeNumber } from "./common-utils.js";

export function normalizeMonthTokenForMatch(token) {
  return String(token || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,:;!?]/g, "")
    .replace(/["'`]/g, "")
    .replace(/ё/g, "е")
    .replace(/(?:st|nd|rd|th)$/i, "")
    .trim();
}

export function normalizeDateSearchText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[пјЏвЃ„]/g, "/")
    .replace(/[пјЋгЂ‚]/g, ".")
    .replace(/[•·・|]/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeYearToken(yearToken) {
  const year = Number.parseInt(String(yearToken || "").trim(), 10);
  if (!Number.isFinite(year) || year <= 0) return 0;
  if (year < 100) return 2000 + year;
  return year;
}

export function isLikelyDateText(text) {
  const normalized = normalizeDateSearchText(text).toLowerCase();
  if (!normalized) return false;

  if (/\d{1,4}\s*[./-]\s*\d{1,2}/u.test(normalized)) return true;

  return /\b(?:date|дата|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|январь|января|янв|февраль|февраля|фев|март|марта|мар|апрель|апреля|апр|май|мая|июнь|июня|июн|июль|июля|июл|август|августа|авг|сентябрь|сентября|сен|сент|октябрь|октября|окт|ноябрь|ноября|ноя|декабрь|декабря|дек|january|february|march|april|june|july|august|september|october|november|december)\b/u.test(normalized);
}

export function monthNameFromToken(token, calData, fallbackMonths = []) {
  const months = calData?.months || fallbackMonths;
  const raw = String(token || "").trim();
  if (!raw) return "";

  const normalizedRaw = normalizeMonthTokenForMatch(raw);
  const aliasMap = {
    jan: "january",
    january: "january",
    feb: "february",
    february: "february",
    mar: "march",
    march: "march",
    apr: "april",
    april: "april",
    may: "may",
    jun: "june",
    june: "june",
    jul: "july",
    july: "july",
    aug: "august",
    august: "august",
    sep: "september",
    sept: "september",
    september: "september",
    oct: "october",
    october: "october",
    nov: "november",
    november: "november",
    dec: "december",
    december: "december",
    "январь": "january",
    "января": "january",
    "янв": "january",
    "февраль": "february",
    "февраля": "february",
    "фев": "february",
    "март": "march",
    "марта": "march",
    "мар": "march",
    "апрель": "april",
    "апреля": "april",
    "апр": "april",
    "май": "may",
    "мая": "may",
    "июнь": "june",
    "июня": "june",
    "июн": "june",
    "июль": "july",
    "июля": "july",
    "июл": "july",
    "август": "august",
    "августа": "august",
    "авг": "august",
    "сентябрь": "september",
    "сентября": "september",
    "сен": "september",
    "сент": "september",
    "октябрь": "october",
    "октября": "october",
    "окт": "october",
    "ноябрь": "november",
    "ноября": "november",
    "ноя": "november",
    "декабрь": "december",
    "декабря": "december",
    "дек": "december",
    "янв": "january",
    "фев": "february",
    "мар": "march",
    "апр": "april",
    "июн": "june",
    "июл": "july",
    "авг": "august",
  };

  for (const m of months) {
    const monthName = String(m?.name || "").trim();
    if (!monthName) continue;
    const normalizedMonth = normalizeMonthTokenForMatch(monthName);
    if (normalizedMonth === normalizedRaw) return monthName;

    if (aliasMap[normalizedRaw] && normalizedMonth === aliasMap[normalizedRaw]) {
      return monthName;
    }
  }

  const numeric = Number.parseInt(normalizedRaw, 10);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= months.length) {
    return months[numeric - 1].name;
  }

  return "";
}

export function buildDateCandidate({
  dayToken,
  monthToken,
  yearToken,
  calData,
  rejectAmbiguousNumeric = false,
  fallbackMonths = [],
}) {
  const day = Number.parseInt(String(dayToken || "").trim(), 10);
  const year = normalizeYearToken(yearToken);

  if (!Number.isFinite(day) || day <= 0 || !year) return null;

  const numericMonthToken = Number.parseInt(String(monthToken || "").trim(), 10);
  if (
    rejectAmbiguousNumeric &&
    Number.isFinite(numericMonthToken) &&
    day <= 12 &&
    numericMonthToken <= 12
  ) {
    return null;
  }

  const month = monthNameFromToken(monthToken, calData, fallbackMonths);
  if (!month) return null;

  const monthEntry = (calData?.months || fallbackMonths).find((entry) => entry.name === month);
  const monthDays = normalizeNumber(monthEntry?.days, 31);

  if (day < 1 || day > monthDays || year <= 0) return null;

  return { day, month, year, source: "infoblock" };
}

export function extractDateFromText(text, calData, options = {}) {
  const raw = String(text || "");
  if (!raw.trim()) return null;

  const fallbackMonths = Array.isArray(options?.fallbackMonths) ? options.fallbackMonths : [];
  const normalized = normalizeDateSearchText(raw);
  if (!normalized || !isLikelyDateText(normalized)) return null;

  const parsers = [
    {
      regex:
        /\b(?:date|дата)\b\s*[:=\-]?\s*(\d{1,2})(?:st|nd|rd|th)?\s+([\p{L}]{3,})\.?\s*,?\s*(\d{2,4})\b/giu,
      pick: (m) => ({ dayToken: m[1], monthToken: m[2], yearToken: m[3] }),
    },
    {
      regex:
        /\b(?:date|дата)\b\s*[:=\-]?\s*(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\b/giu,
      pick: (m) => ({ dayToken: m[3], monthToken: m[2], yearToken: m[1] }),
    },
    {
      regex:
        /\b(?:date|дата)\b\s*[:=\-]?\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})\b/giu,
      pick: (m) => ({ dayToken: m[1], monthToken: m[2], yearToken: m[3] }),
    },
    {
      regex: /\b(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\b/gu,
      pick: (m) => ({ dayToken: m[3], monthToken: m[2], yearToken: m[1] }),
    },
    {
      regex:
        /\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})\b/gu,
      pick: (m) => ({ dayToken: m[1], monthToken: m[2], yearToken: m[3] }),
    },
    {
      regex:
        /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?([\p{L}]{3,})\.?\s*,?\s*(\d{2,4})\b/giu,
      pick: (m) => ({ dayToken: m[1], monthToken: m[2], yearToken: m[3] }),
    },
    {
      regex:
        /\b([\p{L}]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{2,4})\b/giu,
      pick: (m) => ({ dayToken: m[2], monthToken: m[1], yearToken: m[3] }),
    },
  ];

  for (const parser of parsers) {
    parser.regex.lastIndex = 0;

    let match;
    while ((match = parser.regex.exec(normalized)) !== null) {
      const parts = parser.pick(match);
      const candidate = buildDateCandidate({
        ...parts,
        calData,
        rejectAmbiguousNumeric: parser.rejectAmbiguousNumeric === true,
        fallbackMonths,
      });

      if (candidate) return candidate;
    }
  }

  return null;
}
