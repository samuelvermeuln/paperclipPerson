export const SILENT_RUN_WATCHDOG_STATE_KEY = "silentRunWatchdog";
export const SILENT_RUN_SUSPICION_THRESHOLD_MS = 30 * 60 * 1000;
export const SILENT_RUN_ZOMBIE_CANDIDATE_THRESHOLD_MS = 60 * 60 * 1000;
export const SILENT_RUN_NO_LIVENESS_GRACE_MS = 15 * 60 * 1000;
export const SILENT_RUN_FROZEN_GRACE_MS = 30 * 60 * 1000;
export const SILENT_RUN_HARD_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export type SilentRunProcessProbeSource = "none" | "linux_proc" | "ps";

export interface SilentRunWatchdogObservation {
  observedAt: string;
  progressFingerprint: string;
  stallFingerprint: string;
  runtimeLivenessAgeMs: number | null;
  runtimeStatusUpdatedAt: string | null;
  processPid: number | null;
  processGroupId: number | null;
  processAlive: boolean | null;
  processCpuTicks: number | null;
  processState: string | null;
  processProbeSource: SilentRunProcessProbeSource;
}

export interface SilentRunWatchdogState {
  version: 1;
  firstSuspectedAt: string;
  firstFrozenAt: string;
  suspicionNotifiedAt: string | null;
  lastObservation: SilentRunWatchdogObservation;
}

export interface SilentRunWatchdogDecision {
  action: "track" | "notify_suspicious" | "timeout_likely_zombie" | "timeout_hard_cap";
  nextState: SilentRunWatchdogState;
  stateChanged: boolean;
  frozenAgeMs: number;
  hasRecentRuntimeLiveness: boolean;
  processProbeCanJudgeFrozen: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function sameObservation(
  left: SilentRunWatchdogObservation,
  right: SilentRunWatchdogObservation,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameState(
  left: SilentRunWatchdogState | null,
  right: SilentRunWatchdogState,
): boolean {
  return left != null && JSON.stringify(left) === JSON.stringify(right);
}

export function parseSilentRunWatchdogState(value: unknown): SilentRunWatchdogState | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.version !== 1) return null;
  const lastObservationRecord = asRecord(record.lastObservation);
  if (!lastObservationRecord) return null;

  const observedAt = asString(lastObservationRecord.observedAt);
  const progressFingerprint = asString(lastObservationRecord.progressFingerprint);
  const stallFingerprint = asString(lastObservationRecord.stallFingerprint);
  const firstSuspectedAt = asString(record.firstSuspectedAt);
  const firstFrozenAt = asString(record.firstFrozenAt);
  if (!observedAt || !progressFingerprint || !stallFingerprint || !firstSuspectedAt || !firstFrozenAt) {
    return null;
  }

  const processProbeSource = lastObservationRecord.processProbeSource;
  if (processProbeSource !== "none" && processProbeSource !== "linux_proc" && processProbeSource !== "ps") {
    return null;
  }

  return {
    version: 1,
    firstSuspectedAt,
    firstFrozenAt,
    suspicionNotifiedAt: asString(record.suspicionNotifiedAt),
    lastObservation: {
      observedAt,
      progressFingerprint,
      stallFingerprint,
      runtimeLivenessAgeMs: asNumber(lastObservationRecord.runtimeLivenessAgeMs),
      runtimeStatusUpdatedAt: asString(lastObservationRecord.runtimeStatusUpdatedAt),
      processPid: asNumber(lastObservationRecord.processPid),
      processGroupId: asNumber(lastObservationRecord.processGroupId),
      processAlive: asBoolean(lastObservationRecord.processAlive),
      processCpuTicks: asNumber(lastObservationRecord.processCpuTicks),
      processState: asString(lastObservationRecord.processState),
      processProbeSource,
    },
  };
}

export function mergeSilentRunWatchdogState(
  resultJson: Record<string, unknown> | null | undefined,
  state: SilentRunWatchdogState | null,
): Record<string, unknown> | null {
  if (!state) {
    if (!resultJson) return resultJson ?? null;
    const next = { ...resultJson };
    delete next[SILENT_RUN_WATCHDOG_STATE_KEY];
    return next;
  }
  return {
    ...(resultJson ?? {}),
    [SILENT_RUN_WATCHDOG_STATE_KEY]: state,
  };
}

export function applySilentRunWatchdogObservation(input: {
  previous: SilentRunWatchdogState | null;
  observation: SilentRunWatchdogObservation;
  silenceAgeMs: number;
  now?: Date;
}): SilentRunWatchdogDecision {
  const now = input.now ?? new Date(input.observation.observedAt);
  const previous = input.previous;
  const sameSilentWindow =
    previous?.lastObservation.progressFingerprint === input.observation.progressFingerprint;
  const sameStallFingerprint =
    sameSilentWindow && previous?.lastObservation.stallFingerprint === input.observation.stallFingerprint;

  const nextStateBase: SilentRunWatchdogState = sameStallFingerprint && previous
    ? previous
    : {
        version: 1,
        firstSuspectedAt: sameSilentWindow && previous
          ? previous.firstSuspectedAt
          : input.observation.observedAt,
        firstFrozenAt: input.observation.observedAt,
        suspicionNotifiedAt: sameSilentWindow && previous
          ? previous.suspicionNotifiedAt
          : null,
        lastObservation: input.observation,
      };

  const frozenAgeMs = Math.max(0, now.getTime() - new Date(nextStateBase.firstFrozenAt).getTime());
  const hasRecentRuntimeLiveness =
    typeof input.observation.runtimeLivenessAgeMs === "number" &&
    input.observation.runtimeLivenessAgeMs >= 0 &&
    input.observation.runtimeLivenessAgeMs <= SILENT_RUN_NO_LIVENESS_GRACE_MS;
  const processProbeCanJudgeFrozen =
    input.observation.processAlive === true &&
    input.observation.processProbeSource !== "none" &&
    typeof input.observation.processCpuTicks === "number";

  let action: SilentRunWatchdogDecision["action"] = "track";
  let nextState = nextStateBase;

  if (input.silenceAgeMs >= SILENT_RUN_HARD_TIMEOUT_MS && !hasRecentRuntimeLiveness && processProbeCanJudgeFrozen && frozenAgeMs >= SILENT_RUN_FROZEN_GRACE_MS) {
    action = "timeout_hard_cap";
  } else if (input.silenceAgeMs >= SILENT_RUN_ZOMBIE_CANDIDATE_THRESHOLD_MS && !hasRecentRuntimeLiveness && processProbeCanJudgeFrozen && frozenAgeMs >= SILENT_RUN_FROZEN_GRACE_MS) {
    action = "timeout_likely_zombie";
  } else if (input.silenceAgeMs >= SILENT_RUN_SUSPICION_THRESHOLD_MS && !nextStateBase.suspicionNotifiedAt) {
    action = "notify_suspicious";
    nextState = {
      ...nextStateBase,
      suspicionNotifiedAt: input.observation.observedAt,
    };
  }

  return {
    action,
    nextState,
    stateChanged: !sameState(previous, nextState) || !sameStallFingerprint || (sameStallFingerprint && previous != null && !sameObservation(previous.lastObservation, nextState.lastObservation)),
    frozenAgeMs,
    hasRecentRuntimeLiveness,
    processProbeCanJudgeFrozen,
  };
}
