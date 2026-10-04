/** Provider-independent signals. Unknown speech state blocks unsolicited questions. */
export type InterruptionState = {
  sessionId: string;
  revision: number;
  observedAt: number;
  captureActive: boolean;
  offRecord: boolean;
  manualPause: boolean;
  userSpeaking: boolean | null;
  agentSpeaking: boolean | null;
  lastActivityAt: number;
  lastQuestionAt: number | null;
  candidate: { id: string; question: string; screenContext: string } | null;
  modelContextAllowed: boolean;
};

export type TimingReason =
  | "invalid_signals"
  | "inactive"
  | "off_record"
  | "manual_pause"
  | "speech_unknown"
  | "speaking"
  | "stale_context"
  | "activity"
  | "question_cooldown"
  | "no_question"
  | "rules_ready"
  | "context_not_allowed"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_busy"
  | "evaluation_cooldown"
  | "state_changed"
  | "uncertain"
  | "provider_wait"
  | "provider_ready"
  | "cancelled";

export type TimingDecision = {
  action: "ask" | "wait";
  source: "rules" | "jev";
  reason: TimingReason;
  revision: number;
  candidateId: string | null;
  confidence?: number;
  model?: string;
};

export function wait(
  state: InterruptionState,
  reason: TimingReason,
): TimingDecision {
  return {
    action: "wait",
    source: "rules",
    reason,
    revision: state.revision,
    candidateId: state.candidate?.id ?? null,
  };
}

/** No provider can override these gates. Reading is only approximated by quiet time. */
export function checkTiming(
  state: InterruptionState,
  now: number,
): TimingDecision {
  if (
    !state.sessionId ||
    !Number.isInteger(state.revision) ||
    state.revision < 0 ||
    ![now, state.observedAt, state.lastActivityAt].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) ||
    state.observedAt > now ||
    state.lastActivityAt > now ||
    (state.lastQuestionAt !== null &&
      (!Number.isFinite(state.lastQuestionAt) ||
        state.lastQuestionAt < 0 ||
        state.lastQuestionAt > now)) ||
    typeof state.offRecord !== "boolean" ||
    typeof state.captureActive !== "boolean" ||
    typeof state.manualPause !== "boolean"
  )
    return wait(state, "invalid_signals");
  if (state.offRecord) return wait(state, "off_record");
  if (!state.captureActive) return wait(state, "inactive");
  if (state.manualPause) return wait(state, "manual_pause");
  if (
    typeof state.userSpeaking !== "boolean" ||
    typeof state.agentSpeaking !== "boolean"
  )
    return wait(state, "speech_unknown");
  if (state.userSpeaking || state.agentSpeaking) return wait(state, "speaking");
  if (now - state.observedAt > 5000) return wait(state, "stale_context");
  if (now - state.lastActivityAt < 4000) return wait(state, "activity");
  if (state.lastQuestionAt !== null && now - state.lastQuestionAt < 30000)
    return wait(state, "question_cooldown");
  if (
    !state.candidate?.id ||
    !state.candidate.question.trim() ||
    !state.candidate.screenContext.trim()
  )
    return wait(state, "no_question");
  return {
    action: "ask",
    source: "rules",
    reason: "rules_ready",
    revision: state.revision,
    candidateId: state.candidate.id,
  };
}

/** An allow-list: no raw frames/audio, user IDs, keys, full transcripts or extra fields. */
export function toTimingContext(state: InterruptionState, now: number) {
  return {
    pendingQuestion: state.candidate!.question.slice(0, 500),
    visibleContext: state.candidate!.screenContext.slice(0, 1200),
    quietForMs: now - state.lastActivityAt,
    timeSinceLastQuestionMs:
      state.lastQuestionAt === null ? null : now - state.lastQuestionAt,
  };
}
export type TimingContext = ReturnType<typeof toTimingContext>;
