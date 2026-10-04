import {
  checkTiming,
  toTimingContext,
  wait,
  type InterruptionState,
  type TimingContext,
  type TimingDecision,
} from "./policy.ts";

export type ProviderVerdict = {
  choice: "ask" | "wait";
  confidence: number;
  askProbability: number;
  model: string;
};
export interface TimingProvider {
  decide(context: TimingContext, signal: AbortSignal): Promise<ProviderVerdict>;
}

/** One instance per session; never share throttling state across users. */
export function createTimingDecider(options: {
  mode: "rules" | "jev";
  provider?: TimingProvider;
  now?: () => number;
  timeoutMs?: number;
}) {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 800;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5000)
    throw new Error("Invalid timing timeout");
  let busy = false;
  let lastEvaluation = -Infinity;

  return {
    async evaluate(
      readState: () => InterruptionState,
      signal?: AbortSignal,
    ): Promise<TimingDecision> {
      const initial = structuredClone(readState());
      if (signal?.aborted) return wait(initial, "cancelled");
      const gate = checkTiming(initial, now());
      if (gate.action === "wait" || options.mode === "rules") return gate;
      if (initial.modelContextAllowed !== true)
        return wait(initial, "context_not_allowed");
      if (!options.provider) return wait(initial, "provider_unavailable");
      if (busy) return wait(initial, "provider_busy");
      if (now() - lastEvaluation < 2000)
        return wait(initial, "evaluation_cooldown");
      busy = true;
      lastEvaluation = now();
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      let rejectOnAbort: (() => void) | undefined;
      try {
        const cancelled = new Promise<never>((_, reject) => {
          rejectOnAbort = () => reject(new Error("Timing request cancelled"));
          controller.signal.addEventListener("abort", rejectOnAbort, {
            once: true,
          });
        });
        const verdict = await Promise.race([
          options.provider.decide(
            toTimingContext(initial, now()),
            controller.signal,
          ),
          cancelled,
        ]);
        const current = readState();
        const latestGate = checkTiming(current, now());
        if (latestGate.action === "wait") return latestGate;
        if (
          current.sessionId !== initial.sessionId ||
          current.revision !== initial.revision ||
          current.candidate?.id !== initial.candidate?.id ||
          current.modelContextAllowed !== true
        )
          return wait(current, "state_changed");
        if (signal?.aborted) return wait(current, "cancelled");
        if (
          ![verdict.confidence, verdict.askProbability].every(
            (n) => Number.isFinite(n) && n >= 0 && n <= 1,
          )
        )
          return wait(current, "provider_unavailable");
        if (verdict.choice !== "ask")
          return {
            ...wait(current, "provider_wait"),
            source: "jev",
            model: verdict.model,
            confidence: verdict.confidence,
          };
        if (verdict.confidence < 0.8 || verdict.askProbability < 0.8)
          return {
            ...wait(current, "uncertain"),
            source: "jev",
            model: verdict.model,
            confidence: verdict.confidence,
          };
        return {
          ...latestGate,
          source: "jev",
          reason: "provider_ready",
          confidence: verdict.confidence,
          model: verdict.model,
        };
      } catch {
        return wait(
          readState(),
          signal?.aborted
            ? "cancelled"
            : timedOut
              ? "provider_timeout"
              : "provider_unavailable",
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (rejectOnAbort)
          controller.signal.removeEventListener("abort", rejectOnAbort);
        busy = false;
      }
    },
  };
}
