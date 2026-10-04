import type { Evidence } from "./processes.ts";

export type Utterance = {
  id: string;
  role: "user" | "agent";
  text: string;
  at: string;
};
export type Source = { frameId: string; utteranceId: string; quote: string };
export type WorkStep = Source & {
  id: string;
  title: string;
  action: string;
  applications?: string[];
  actor?: { name: string; utteranceId: string; quote: string };
  decision: string;
  reason: string;
  provenance: "observed" | "explained";
};
export type WorkMap = {
  title: string;
  summary: string;
  steps: WorkStep[];
  edges: { from: string; to: string; label: string }[];
  guardrails: (Source & { rule: string; stepId: string })[];
  questions: string[];
};
export type Observation = {
  description: string;
  question: string;
  changed: boolean;
};

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_object");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 1500, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  )
    throw new Error("invalid_text");
  return value;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("invalid_list");
  return value;
}
export function parseEvidence(value: unknown, allowEmpty = false): Evidence[] {
  const frames = list(value, 12).map((v) => {
    const f = object(v);
    const image = text(f.image, 900_000);
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image))
      throw new Error("invalid_image");
    return {
      id: text(f.id, 80),
      image,
      time: text(f.time, 80),
      capturedAt: text(f.capturedAt, 40),
      note: text(f.note, 1500, true),
    };
  });
  if (
    (!allowEmpty && !frames.length) ||
    new Set(frames.map((f) => f.id)).size !== frames.length
  )
    throw new Error("invalid_frames");
  return frames;
}
export function parseTranscript(value: unknown): Utterance[] {
  const transcript = list(value, 200).map((v) => {
    const u = object(v);
    if (u.role !== "user" && u.role !== "agent")
      throw new Error("invalid_role");
    return {
      id: text(u.id, 100),
      role: u.role,
      text: text(u.text, 4000),
      at: text(u.at, 40),
    } as Utterance;
  });
  if (new Set(transcript.map((u) => u.id)).size !== transcript.length)
    throw new Error("duplicate_utterance");
  return transcript;
}
/** Source existence is verifiable; semantic accuracy still requires expert review. */
export function parseWorkMap(
  value: unknown,
  frames: Evidence[],
  transcript: Utterance[],
): WorkMap {
  const m = object(value);
  function source(
    s: Record<string, unknown>,
    quoteRequired: boolean,
    allowNoFrame = false,
  ): Source {
    const frameId = text(s.frameId, 80, allowNoFrame);
    if (frameId && !frames.some((f) => f.id === frameId))
      throw new Error("missing_frame");
    if (!frameId) quoteRequired = true;
    const utteranceId = text(s.utteranceId, 100, !quoteRequired);
    const quote = text(s.quote, 4000, !quoteRequired);
    if (utteranceId || quote) {
      if (
        !quote ||
        !transcript.some(
          (u) =>
            u.id === utteranceId && u.role === "user" && u.text.includes(quote),
        )
      )
        throw new Error("unsupported_quote");
    }
    return { frameId, utteranceId, quote };
  }
  const steps = list(m.steps, 20).map((v) => {
    const s = object(v);
    if (s.provenance !== "observed" && s.provenance !== "explained")
      throw new Error("invalid_provenance");
    const evidenceSource = source(
      s,
      s.provenance === "explained",
      s.provenance === "explained",
    );
    if (s.reason && !evidenceSource.quote)
      throw new Error("unsupported_reason");
    let actor: WorkStep["actor"];
    if (s.actor !== undefined) {
      const a = object(s.actor);
      const name = text(a.name, 80, true),
        quote = text(a.quote, 4000, true),
        utteranceId = text(a.utteranceId, 100, true);
      if (
        name &&
        (!quote ||
          !transcript.some(
            (u) =>
              u.id === utteranceId &&
              u.role === "user" &&
              u.text.includes(quote),
          ))
      )
        throw new Error("unsupported_actor");
      if (!name && (quote || utteranceId)) throw new Error("invalid_actor");
      actor = { name, quote, utteranceId };
    }
    return {
      ...evidenceSource,
      id: text(s.id, 60),
      title: text(s.title, 160),
      action: text(s.action),
      ...(actor ? { actor } : {}),
      ...(s.applications === undefined
        ? {}
        : {
            applications: [
              ...new Set(list(s.applications, 4).map((app) => text(app, 80))),
            ],
          }),
      decision: text(s.decision, 1500, true),
      reason: text(s.reason, 1500, true),
      provenance: s.provenance,
    } as WorkStep;
  });
  if (!steps.length || new Set(steps.map((s) => s.id)).size !== steps.length)
    throw new Error("invalid_steps");
  const hasStep = (id: string) => steps.some((s) => s.id === id);
  const edges = list(m.edges, 40).map((v) => {
    const e = object(v);
    const from = text(e.from, 60),
      to = text(e.to, 60);
    if (!hasStep(from) || !hasStep(to) || from === to)
      throw new Error("invalid_edge");
    return { from, to, label: text(e.label, 250, true) };
  });
  const guardrails = list(m.guardrails, 20).map((v) => {
    const g = object(v);
    const stepId = text(g.stepId, 60);
    if (!hasStep(stepId)) throw new Error("invalid_guardrail");
    return { ...source(g, true, true), stepId, rule: text(g.rule) };
  });
  const questions = list(m.questions, 10).map((v) => text(v, 500));
  return {
    title: text(m.title, 120),
    summary: text(m.summary, 2000),
    steps,
    edges,
    guardrails,
    questions,
  };
}
export function parseObservation(value: unknown): Observation {
  const o = object(value);
  if (typeof o.changed !== "boolean") throw new Error("invalid_observation");
  return {
    description: text(o.description, 1500),
    question: text(o.question, 500, true),
    changed: o.changed,
  };
}
