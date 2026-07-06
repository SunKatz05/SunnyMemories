export function parseAIResponseJSON(text) {
  if (!text || typeof text !== "string") return null;

  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");

  let start = -1;
  let openChar = "{",
    closeChar = "}";

  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj;
  } else if (firstArr !== -1) {
    start = firstArr;
    openChar = "[";
    closeChar = "]";
  }

  if (start === -1) return null;

  for (let i = start; i < text.length; i++) {
    if (text[i] === openChar) {
      let depth = 0;
      for (let j = i; j < text.length; j++) {
        if (text[j] === openChar) depth++;
        else if (text[j] === closeChar) depth--;

        if (depth === 0) {
          try {
            return JSON.parse(text.slice(i, j + 1));
          } catch (e) {
            break;
          }
        }
      }
    }
  }

  console.error("SunnyMemories: JSON parse error - No balanced JSON found.");
  return null;
}

export function normalizeParsedEventsPayload(parsed) {
  if (!parsed) return null;

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.events)) {
    return parsed.events;
  }

  if (Array.isArray(parsed?.data?.events)) {
    return parsed.data.events;
  }

  if (Array.isArray(parsed?.result?.events)) {
    return parsed.result.events;
  }

  if (parsed.event && typeof parsed.event === "object") {
    return [parsed.event];
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed.day != null || parsed.month != null || parsed.year != null) &&
    (parsed.description != null || parsed.title != null || parsed.summary != null)
  ) {
    return [parsed];
  }

  return null;
}
