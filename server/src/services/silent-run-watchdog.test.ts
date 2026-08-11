import { describe, expect, it } from "vitest";
import {
  applySilentRunWatchdogObservation,
  parseSilentRunWatchdogState,
  SILENT_RUN_FROZEN_GRACE_MS,
  SILENT_RUN_HARD_TIMEOUT_MS,
  SILENT_RUN_SUSPICION_THRESHOLD_MS,
  SILENT_RUN_WATCHDOG_STATE_KEY,
  SILENT_RUN_ZOMBIE_CANDIDATE_THRESHOLD_MS,
  mergeSilentRunWatchdogState,
  type SilentRunWatchdogObservation,
  type SilentRunWatchdogState,
} from "./silent-run-watchdog.js";

function buildObservation(overrides: Partial<SilentRunWatchdogObservation> = {}): SilentRunWatchdogObservation {
  return {
    observedAt: "2026-08-11T12:00:00.000Z",
    progressFingerprint: JSON.stringify({ lastOutputSeq: 1, lastOutputBytes: 10, logBytes: 10 }),
    stallFingerprint: JSON.stringify({ cpuTicks: 100, runtimeStatusUpdatedAt: null }),
    runtimeLivenessAgeMs: null,
    runtimeStatusUpdatedAt: null,
    processPid: 123,
    processGroupId: 123,
    processAlive: true,
    processCpuTicks: 100,
    processState: "S",
    processProbeSource: "linux_proc",
    ...overrides,
  };
}

function buildState(observation: SilentRunWatchdogObservation, overrides: Partial<SilentRunWatchdogState> = {}): SilentRunWatchdogState {
  return {
    version: 1,
    firstSuspectedAt: observation.observedAt,
    firstFrozenAt: observation.observedAt,
    suspicionNotifiedAt: null,
    lastObservation: observation,
    ...overrides,
  };
}

describe("silent-run watchdog", () => {
  it("marks silent runs suspicious before timing them out", () => {
    const observation = buildObservation();
    const decision = applySilentRunWatchdogObservation({
      previous: null,
      observation,
      silenceAgeMs: SILENT_RUN_SUSPICION_THRESHOLD_MS,
      now: new Date(observation.observedAt),
    });

    expect(decision.action).toBe("notify_suspicious");
    expect(decision.nextState.suspicionNotifiedAt).toBe(observation.observedAt);
  });

  it("does not time out a silent run when runtime liveness is still fresh", () => {
    const previousObservation = buildObservation();
    const previous = buildState(previousObservation, {
      firstFrozenAt: new Date(Date.parse(previousObservation.observedAt) - SILENT_RUN_FROZEN_GRACE_MS - 1_000).toISOString(),
      suspicionNotifiedAt: previousObservation.observedAt,
    });
    const observation = buildObservation({
      observedAt: "2026-08-11T12:25:00.000Z",
      runtimeLivenessAgeMs: 2 * 60 * 1000,
      runtimeStatusUpdatedAt: "2026-08-11T12:23:00.000Z",
      stallFingerprint: JSON.stringify({ cpuTicks: 100, runtimeStatusUpdatedAt: "2026-08-11T12:23:00.000Z" }),
    });
    const decision = applySilentRunWatchdogObservation({
      previous,
      observation,
      silenceAgeMs: SILENT_RUN_ZOMBIE_CANDIDATE_THRESHOLD_MS + 5 * 60 * 1000,
      now: new Date(observation.observedAt),
    });

    expect(decision.action).toBe("track");
    expect(decision.hasRecentRuntimeLiveness).toBe(true);
  });

  it("times out a likely zombie only after frozen silence persists past grace window", () => {
    const previousObservation = buildObservation();
    const previous = buildState(previousObservation, {
      firstFrozenAt: new Date(Date.parse(previousObservation.observedAt) - SILENT_RUN_FROZEN_GRACE_MS - 1_000).toISOString(),
      suspicionNotifiedAt: previousObservation.observedAt,
    });
    const observation = buildObservation({
      observedAt: "2026-08-11T12:25:00.000Z",
    });
    const decision = applySilentRunWatchdogObservation({
      previous,
      observation,
      silenceAgeMs: SILENT_RUN_ZOMBIE_CANDIDATE_THRESHOLD_MS + 5 * 60 * 1000,
      now: new Date(observation.observedAt),
    });

    expect(decision.action).toBe("timeout_likely_zombie");
    expect(decision.processProbeCanJudgeFrozen).toBe(true);
  });

  it("resets suspicion when a new output fingerprint starts a new silent window", () => {
    const previousObservation = buildObservation();
    const previous = buildState(previousObservation, {
      suspicionNotifiedAt: previousObservation.observedAt,
    });
    const observation = buildObservation({
      observedAt: "2026-08-11T13:00:00.000Z",
      progressFingerprint: JSON.stringify({ lastOutputSeq: 2, lastOutputBytes: 20, logBytes: 20 }),
      stallFingerprint: JSON.stringify({ cpuTicks: 101, runtimeStatusUpdatedAt: null }),
      processCpuTicks: 101,
    });
    const decision = applySilentRunWatchdogObservation({
      previous,
      observation,
      silenceAgeMs: SILENT_RUN_SUSPICION_THRESHOLD_MS,
      now: new Date(observation.observedAt),
    });

    expect(decision.action).toBe("notify_suspicious");
    expect(decision.nextState.firstSuspectedAt).toBe(observation.observedAt);
    expect(decision.nextState.suspicionNotifiedAt).toBe(observation.observedAt);
  });

  it("promotes to hard cap only after long frozen silence", () => {
    const previousObservation = buildObservation();
    const previous = buildState(previousObservation, {
      firstFrozenAt: new Date(Date.parse(previousObservation.observedAt) - SILENT_RUN_FROZEN_GRACE_MS - 1_000).toISOString(),
      suspicionNotifiedAt: previousObservation.observedAt,
    });
    const observation = buildObservation({ observedAt: "2026-08-12T01:00:00.000Z" });
    const decision = applySilentRunWatchdogObservation({
      previous,
      observation,
      silenceAgeMs: SILENT_RUN_HARD_TIMEOUT_MS + 1,
      now: new Date(observation.observedAt),
    });

    expect(decision.action).toBe("timeout_hard_cap");
  });

  it("round-trips persisted watchdog state in resultJson", () => {
    const observation = buildObservation();
    const state = buildState(observation, { suspicionNotifiedAt: observation.observedAt });
    const merged = mergeSilentRunWatchdogState({ existing: true }, state);
    const parsed = parseSilentRunWatchdogState((merged as Record<string, unknown>)[SILENT_RUN_WATCHDOG_STATE_KEY]);

    expect(parsed).toEqual(state);
  });
});
