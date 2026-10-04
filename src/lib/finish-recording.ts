import type { RecordedProcess, RecordingInput } from "./processes.ts";
import { parseWorkMap } from "./work-map.ts";

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
  if (version.privacy?.engine === "demo-fallback")
    return {
      process: saved,
      warning:
        "Local only: manual review required — demo filter, not a Presidio scan. Nothing sent to AI.",
    };
  if (
    !input.evidence.length &&
    !input.transcript?.some((u) => u.role === "user")
  )
    return {
      process: saved,
      warning:
        "Only metadata saved. Images were withheld and there is no conversation source for a process map.",
    };
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
