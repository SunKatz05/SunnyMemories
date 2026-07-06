import { normInt } from "./common-utils.js";

export function isPeriodic(freq, userTurnCount) {
  const n = Number.isFinite(freq) ? freq : 1;
  if (n <= 0) return false;
  if (n === 1) return true;
  const turns = Math.max(0, normInt(userTurnCount, 0));
  return turns > 0 && turns % n === 0;
}

export function getContextInjectionAnchors(mem) {
  if (!mem || typeof mem !== "object") return {};
  if (!mem._contextInjectionAnchors || typeof mem._contextInjectionAnchors !== "object") {
    mem._contextInjectionAnchors = {};
  }
  return mem._contextInjectionAnchors;
}

export function clearContextInjectionAnchor(anchors, key) {
  if (!anchors || typeof anchors !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(anchors, key)) return false;
  delete anchors[key];
  return true;
}

export function buildContextInjectionSignature(parts = []) {
  return parts
    .map((part) => {
      if (part === null || part === undefined) return "";
      return String(part).trim();
    })
    .join("|");
}

export function canonicalizeSignatureText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function shouldRefreshContextAnchor({
  anchors,
  key,
  chatLength,
  timelineValue,
  frequency,
  signature,
  driftThreshold = 20,
  useSignatureTrigger = false,
}) {
  const freq = Math.max(1, normInt(frequency, 1));
  const nowTimelineValue = Math.max(
    0,
    normInt(
      timelineValue !== undefined && timelineValue !== null
        ? timelineValue
        : chatLength,
      0,
    ),
  );
  const nowChatLength = Math.max(0, normInt(chatLength, 0));

  const prev =
    anchors && typeof anchors[key] === "object" && anchors[key] !== null
      ? anchors[key]
      : null;

  const prevTimelineValue = Number.isFinite(prev?.timelineValue)
    ? Number(prev.timelineValue)
    : Number.isFinite(prev?.chatLength)
      ? Number(prev.chatLength)
      : null;
  const prevSignature = typeof prev?.signature === "string" ? prev.signature : "";

  const signatureChanged = signature !== prevSignature;
  const anchorMissing = prevTimelineValue === null;
  const anchorInvalid = prevTimelineValue !== null && nowTimelineValue < prevTimelineValue;
  const distance =
    prevTimelineValue === null
      ? Number.POSITIVE_INFINITY
      : nowTimelineValue - prevTimelineValue;

  const maxDrift = Math.max(4, Math.min(40, normInt(driftThreshold, 20)));
  const dueByFrequency = distance >= freq;
  const dueByDrift = distance >= maxDrift;

  const shouldRefresh =
    anchorMissing ||
    anchorInvalid ||
    (useSignatureTrigger && signatureChanged) ||
    dueByFrequency ||
    dueByDrift;

  if (shouldRefresh && anchors) {
    anchors[key] = {
      chatLength: nowChatLength,
      timelineValue: nowTimelineValue,
      signature,
    };
  }

  return shouldRefresh;
}

export function shouldInjectContextBlock({
  anchors,
  key,
  chatLength,
  timelineValue,
  frequency,
  signature,
  force = false,
}) {
  if (!anchors || typeof anchors !== "object" || !key) {
    return { shouldInject: false, stateChanged: false };
  }

  const nowTimelineValue = Math.max(
    0,
    normInt(
      timelineValue !== undefined && timelineValue !== null ? timelineValue : chatLength,
      0,
    ),
  );
  const freq = Math.max(1, normInt(frequency, 1));

  const prev =
    anchors && typeof anchors[key] === "object" && anchors[key] !== null
      ? anchors[key]
      : {};
  const prevSerialized = JSON.stringify(prev);

  const lastInjectedAt = Number.isFinite(prev?.lastInjectedAt)
    ? Number(prev.lastInjectedAt)
    : null;
  const anchorInvalid = lastInjectedAt !== null && nowTimelineValue < lastInjectedAt;
  const distance =
    lastInjectedAt === null ? Number.POSITIVE_INFINITY : nowTimelineValue - lastInjectedAt;
  const dueByFrequency = distance >= freq;

  const signatureChanged = signature !== (typeof prev?.signature === "string" ? prev.signature : "");
  const shouldInject =
    force || signatureChanged || lastInjectedAt === null || anchorInvalid || dueByFrequency;

  const next = {
    ...prev,
    chatLength: Math.max(0, normInt(chatLength, 0)),
    timelineValue: nowTimelineValue,
  };

  if (signatureChanged) {
    next.dirty = true;
    next.pendingSignature = signature;
  }

  if (shouldInject) {
    next.lastInjectedAt = nowTimelineValue;
    next.lastRefreshAt = nowTimelineValue;
    next.signature = signature;
    delete next.dirty;
    delete next.pendingSignature;
  }

  anchors[key] = next;
  return {
    shouldInject,
    stateChanged: prevSerialized !== JSON.stringify(next),
  };
}

export function isPeriodicContextInjection(frequency, userTurnCount) {
  const freq = normInt(frequency, 1);
  const turns = Math.max(0, normInt(userTurnCount, 0));

  if (freq <= 0) return false;
  if (turns <= 0) return false;
  if (freq === 1) return true;

  return turns % freq === 0;
}

export function shouldInjectPeriodicContextBlock({
  anchors,
  key,
  chatLength,
  userTurnCount,
  frequency,
  signature,
  force = false,
}) {
  if (!anchors || typeof anchors !== "object" || !key) {
    return { shouldInject: false, stateChanged: false };
  }

  const nowTimelineValue = Math.max(0, normInt(userTurnCount, 0));
  const prev =
    anchors && typeof anchors[key] === "object" && anchors[key] !== null
      ? anchors[key]
      : {};
  const prevSerialized = JSON.stringify(prev);

  const prevSignature = typeof prev?.signature === "string" ? prev.signature : "";
  const signatureChanged = signature !== prevSignature;
  const lastInjectedAt = Number.isFinite(prev?.lastInjectedAt)
    ? Number(prev.lastInjectedAt)
    : null;

  const periodicShouldInject = isPeriodicContextInjection(frequency, nowTimelineValue);
  const duplicateInjection =
    lastInjectedAt !== null && lastInjectedAt === nowTimelineValue && !signatureChanged;
  const shouldInject = force || (periodicShouldInject && !duplicateInjection);

  const next = {
    ...prev,
    chatLength: Math.max(0, normInt(chatLength, 0)),
    timelineValue: nowTimelineValue,
  };

  if (signatureChanged) {
    next.dirty = true;
    next.pendingSignature = signature;
  }

  if (shouldInject) {
    next.lastInjectedAt = nowTimelineValue;
    next.lastRefreshAt = nowTimelineValue;
    next.signature = signature;
    delete next.dirty;
    delete next.pendingSignature;
  }

  anchors[key] = next;
  return {
    shouldInject,
    stateChanged: prevSerialized !== JSON.stringify(next),
  };
}

export function getAnchoredPromptDepth({ anchors, key, chatLength, timelineValue, baseDepth }) {
  const base = Math.max(0, normInt(baseDepth, 0));
  if (!anchors || typeof anchors !== "object" || !key) return base;

  const nowTimelineValue = Math.max(
    0,
    normInt(
      timelineValue !== undefined && timelineValue !== null ? timelineValue : chatLength,
      0,
    ),
  );

  const anchor =
    anchors && typeof anchors[key] === "object" && anchors[key] !== null
      ? anchors[key]
      : null;
  if (!anchor) return base;

  const anchorTimelineValue = Number.isFinite(anchor?.timelineValue)
    ? Number(anchor.timelineValue)
    : Number.isFinite(anchor?.chatLength)
      ? Number(anchor.chatLength)
      : null;

  if (anchorTimelineValue === null || nowTimelineValue < anchorTimelineValue) return base;

  const distance = nowTimelineValue - anchorTimelineValue;
  return Math.max(0, base + Math.max(0, distance));
}
