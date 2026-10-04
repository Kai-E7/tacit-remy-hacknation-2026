import type { RecordedProcess, RecordingInput } from "./processes.ts";
import { parseWorkMap, type WorkMap } from "./work-map.ts";

/** Safe local documentation fallback: uses only the already-redacted user transcript. */
function buildRedactedVoiceDraft(transcript: NonNullable<RecordingInput["transcript"]>): WorkMap | null {
  const userTurns = transcript.filter((turn) => turn.role === "user" && turn.text.trim());
  if (!userTurns.length) return null;
  const steps = userTurns.slice(0, 20).map((turn, index) => ({
    id: `voice-draft-${index + 1}`,
    frameId: "",
    utteranceId: turn.id,
    quote: turn.text,
    title: `Explained step ${index + 1}`,
    action: turn.text,
    decision: "",
    reason: "",
    provenance: "explained" as const,
  }));
  return {
    title: "Voice process draft",
    summary: "A privacy-filtered voice transcript arranged as a draft process. Review the wording and decisions before using it as guidance.",
    steps,
    edges: steps.slice(1).map((step, index) => ({ from: steps[index].id, to: step.id, label: "then" })),
    guardrails: [],
    questions: ["Which decisions, exceptions or responsible roles should be added to this draft?"],
  };
}

/** Commit source evidence first. A model failure must never lose the recording. */
export async function finishRecording(
  input: RecordingInput,
  options: {
    signal: AbortSignal;
    generateMap: boolean;
    save(input: RecordingInput): Promise<RecordedProcess>;
    attach(
      id: string,
      owner: string,
      version: string,
      expectedTitle: string,
      map: unknown,
    ): Promise<RecordedProcess>;
    onSaved(process: RecordedProcess): void;
    request?: typeof fetch;
  },
): Promise<{ process: RecordedProcess; warning?: string }> {
  const saved = await options.save(input);
  options.onSaved(saved);
  // The store's gate may remove images and redact text. Never reuse raw input.
  const version = saved.versions.find((v) => v.id === input.versionId)!;
  input = {
    ...input,
    title: saved.title,
    evidence: version.evidence,
    transcript: version.transcript,
    privacy: version.privacy,
  };
  const fallbackPrivacy = version.privacy?.engine === "demo-fallback";
  if (
    !input.evidence.length &&
    !input.transcript?.some((u) => u.role === "user")
  )
    return {
      process: saved,
      warning:
        "Only metadata saved. Images were withheld and there is no conversation source for a process map.",
    };
  if (fallbackPrivacy) {
    const draft = buildRedactedVoiceDraft(input.transcript ?? []);
    if (draft) {
      try {
        const process = await options.attach(input.processId, input.owner.id, input.versionId, input.title, draft);
        return { process, warning: "Saved with a basic privacy-filtered draft. Manual review is required; Presidio was unavailable and no AI call was made." };
      } catch {
        // The cleaned recording remains safely saved even if the draft attachment fails.
      }
    }
    return { process: saved, warning: "Saved safely. Manual review is required; Presidio was unavailable and no AI call was made." };
  }
  if (!options.generateMap || options.signal.aborted) return { process: saved };
  // A storage retry may find an already completed version; do not spend twice.
  if (saved.versions.find((v) => v.id === input.versionId)?.workMap)
    return { process: saved };
  try {
    const response = await (options.request ?? fetch)("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        mode:
          input.recordingMode === "voice" || !input.evidence.length
            ? "voice-map"
            : "map",
        frames: input.evidence,
        transcript: input.transcript ?? [],
      }),
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(95000)]),
    });
    if (!response.ok) throw new Error("map_unavailable");
    const body = await response.json();
    const map = parseWorkMap(body.map, input.evidence, input.transcript ?? []);
    options.signal.throwIfAborted();
    const process = await options.attach(
      input.processId,
      input.owner.id,
      input.versionId,
      input.title,
      map,
    );
    return { process };
  } catch {
    return {
      process: saved,
      warning: "Recording saved. Process map not available yet.",
    };
  }
}
