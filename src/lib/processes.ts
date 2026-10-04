import {
  parseWorkMap,
  parseTranscript,
  type WorkMap,
  type Utterance,
} from "./work-map.ts";
import type { PrivacyReport } from "./privacy.ts";
// Keep the stable ID so existing browser-local recordings remain accessible.
export const CURRENT_USER = { id: "local-demo-user", name: "Demo-User" } as const;

export function displayExpertName(expert: { id: string; name: string }): string {
  return expert.id === CURRENT_USER.id ? CURRENT_USER.name : expert.name;
}

export type Evidence = {
  id: string;
  image: string;
  time: string;
  capturedAt: string;
  note: string;
};
export type ProcessConflict = {
  id: string;
  priorVersionId: string;
  currentVersionId: string;
  priorEvidenceIds: string[];
  currentEvidenceIds: string[];
  question: string;
  status: "open" | "resolved";
  resolution?: string;
};
export type ProcessVersion = {
  privacy?: PrivacyReport;
  recordingMode?: "voice";
  id: string;
  number: number;
  basedOnVersionId: string | null;
  createdAt: string;
  recordedBy: { id: string; name: string };
  status: "recorded";
  summary: string;
  evidence: Evidence[];
  transcript?: Utterance[];
  workMap?: WorkMap;
  reviewedAt?: string;
  kind?: "revision";
  revisionNote?: string;
  editedStepIds?: string[];
  origin?: { processId: string; title: string; number: number };
};
export type RecordedProcess = {
  schemaVersion: 1;
  /** Seeded fixture, not a real recording, expert approval or privacy scan. */
  demo?: true;
  id: string;
  ownerId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  versions: ProcessVersion[];
  conflicts: ProcessConflict[];
  mergedIntoId?: string;
};
export type RecordingInput = {
  privacy?: PrivacyReport;
  recordingMode?: "voice";
  processId: string;
  versionId: string;
  owner: { id: string; name: string };
  title: string;
  summary: string;
  evidence: Evidence[];
  basedOnVersionId: string | null;
  now: string;
  transcript?: Utterance[];
  workMap?: WorkMap;
  reviewedAt?: string;
};

/** Append-only recording history. Recorded evidence is not approved agent knowledge. */
export function appendRecording(
  existing: RecordedProcess | undefined,
  input: RecordingInput,
): RecordedProcess {
  if (!input.title.trim() || input.title.trim().length > 120)
    throw new Error(
      "Enter a process name of at most 120 characters.",
    );
  if (input.summary.length > 2000)
    throw new Error("The description must be at most 2,000 characters.");
  if (
    (!input.evidence.length &&
      !input.privacy &&
      !(
        input.recordingMode === "voice" &&
        input.transcript?.some((u) => u.role === "user" && u.text.trim())
      )) ||
    input.evidence.length > 12
  )
    throw new Error(
      "Save between one and twelve screen evidence frames, or a voice interview with a spoken explanation.",
    );
  if (
    input.evidence.some(
      (item) =>
        !item.image.startsWith("data:image/jpeg;base64,") ||
        !item.id ||
        !item.capturedAt,
    )
  )
    throw new Error("Invalid screen evidence.");
  if (
    existing &&
    (existing.ownerId !== input.owner.id || existing.id !== input.processId)
  )
    throw new Error("This process does not belong to the selected profile.");
  if (
    input.basedOnVersionId &&
    !existing?.versions.some((version) => version.id === input.basedOnVersionId)
  )
    throw new Error(
      "The reference version is no longer available. Reopen the process from the library.",
    );
  if (existing?.versions.some((version) => version.id === input.versionId))
    return existing;
  const version: ProcessVersion = {
    ...(input.privacy ? { privacy: { ...input.privacy } } : {}),
    ...(input.recordingMode === "voice"
      ? { recordingMode: "voice" as const }
      : {}),
    id: input.versionId,
    number: (existing?.versions.length ?? 0) + 1,
    basedOnVersionId: input.basedOnVersionId,
    createdAt: input.now,
    recordedBy: { ...input.owner },
    status: "recorded",
    summary: input.summary.trim(),
    evidence: input.evidence.map((item) => ({ ...item })),
    transcript: input.transcript
      ? parseTranscript(input.transcript)
      : undefined,
    workMap: input.workMap
      ? parseWorkMap(input.workMap, input.evidence, input.transcript ?? [])
      : undefined,
    reviewedAt:
      input.workMap && input.reviewedAt ? input.reviewedAt : undefined,
  };
  return {
    schemaVersion: 1,
    id: input.processId,
    ownerId: input.owner.id,
    title: existing?.title ?? input.title.trim(),
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
    versions: [...(existing?.versions ?? []), version],
    conflicts: existing?.conflicts ?? [],
  };
}

/** Group explicitly selected records without changing their source material or inventing lineage. */
export function mergeRecordedProcesses(
  target: RecordedProcess,
  source: RecordedProcess,
  ownerId: string,
  now: string,
): RecordedProcess {
  if (
    target.id === source.id ||
    target.ownerId !== ownerId ||
    source.ownerId !== ownerId ||
    target.mergedIntoId ||
    source.mergedIntoId
  )
    throw new Error("These processes cannot be merged.");
  const ids = new Set(target.versions.map((v) => v.id));
  if (source.versions.some((v) => ids.has(v.id)))
    throw new Error("Duplicate version ID: merge cancelled.");
  const versions = [
    ...target.versions.map((v) => ({
      ...v,
      origin: v.origin ?? {
        processId: target.id,
        title: target.title,
        number: v.number,
      },
    })),
    ...source.versions.map((v) => ({
      ...v,
      origin: v.origin ?? {
        processId: source.id,
        title: source.title,
        number: v.number,
      },
    })),
  ]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((v, i) => ({ ...v, number: i + 1 }));
  if (
    versions.some(
      (v) =>
        v.basedOnVersionId &&
        !versions.some((p) => p.id === v.basedOnVersionId),
    )
  )
    throw new Error("A reference version is missing.");
  return {
    ...target,
    versions,
    conflicts: [...target.conflicts, ...source.conflicts],
    updatedAt: now,
  };
}

/** A manual correction is a new unreviewed version, not a new screen observation. */
export function reviseProcessStep(
  process: RecordedProcess,
  ownerId: string,
  input: {
    baseVersionId: string;
    stepId: string;
    title: string;
    action: string;
    note: string;
    versionId: string;
    now: string;
  },
): RecordedProcess {
  const base = referenceVersion(process, ownerId, input.baseVersionId);
  if (!base.workMap?.steps.some((s) => s.id === input.stepId))
    throw new Error("Process step unavailable.");
  if (!input.note.trim() || input.note.length > 1000)
    throw new Error("Briefly explain the change (at most 1,000 characters).");
  if (process.versions.some((v) => v.id === input.versionId)) return process;
  const map = parseWorkMap(
    {
      ...base.workMap,
      steps: base.workMap.steps.map((s) =>
        s.id === input.stepId
          ? {
              ...s,
              title: input.title.trim(),
              action: input.action.trim(),
              applications: undefined,
            }
          : s,
      ),
    },
    base.evidence,
    base.transcript ?? [],
  );
  // Old quotes/images remain unchanged; revised wording is explicitly marked in the view.
  const version: ProcessVersion = {
    ...structuredClone(base),
    id: input.versionId,
    number: process.versions.length + 1,
    basedOnVersionId: base.id,
    createdAt: input.now,
    kind: "revision",
    revisionNote: input.note.trim(),
    reviewedAt: undefined,
    editedStepIds: [...new Set([...(base.editedStepIds ?? []), input.stepId])],
    workMap: map,
  };
  return {
    ...process,
    versions: [...process.versions, version],
    updatedAt: input.now,
  };
}

/** A typed expert correction is a new, unapproved, source-linked version. */
export function correctExpertRule(
  process: RecordedProcess,
  ownerId: string,
  input: {
    baseVersionId: string;
    target: string;
    statement: string;
    scanReport?: PrivacyReport;
    versionId: string;
    now: string;
  },
): RecordedProcess {
  const base = referenceVersion(process, ownerId, input.baseVersionId);
  if (!base.workMap || base.privacy?.engine !== "presidio" || base.privacy.imagesWithheld)
    throw new Error("This version needs a complete privacy review before correcting a rule.");
  const statement = input.statement.trim();
  if (!statement || statement.length > 500)
    throw new Error("Enter a specific expert statement of at most 500 characters.");
  if (process.versions.some((v) => v.id === input.versionId)) return process;
  const utteranceId = `manual-${input.versionId}`;
  const transcript = [...(base.transcript ?? []), {
    id: utteranceId, role: "user" as const, text: statement, at: input.now,
  }];
  const map = structuredClone(base.workMap);
  let stepId = "";
  if (input.target.startsWith("step:")) {
    stepId = input.target.slice(5);
    const step = map.steps.find((s) => s.id === stepId);
    if (!step) throw new Error("Process step unavailable.");
    const oldQuote = step.quote, oldUtteranceId = step.utteranceId;
    step.quote = statement;
    step.utteranceId = utteranceId;
    step.reason = statement;
    step.provenance = "explained";
    for (const guardrail of map.guardrails) {
      if (guardrail.stepId === stepId && guardrail.quote === oldQuote && guardrail.utteranceId === oldUtteranceId) {
        guardrail.rule = statement;
        guardrail.quote = statement;
        guardrail.utteranceId = utteranceId;
      }
    }
  } else if (input.target.startsWith("guardrail:")) {
    const index = Number(input.target.slice(10));
    const guardrail = Number.isInteger(index) ? map.guardrails[index] : undefined;
    if (!guardrail) throw new Error("Expert rule unavailable.");
    const oldQuote = guardrail.quote, oldUtteranceId = guardrail.utteranceId;
    guardrail.rule = statement;
    guardrail.quote = statement;
    guardrail.utteranceId = utteranceId;
    stepId = guardrail.stepId;
    for (const step of map.steps) {
      if (step.id === stepId && step.quote === oldQuote && step.utteranceId === oldUtteranceId) {
        step.quote = statement;
        step.utteranceId = utteranceId;
        step.reason = statement;
        step.provenance = "explained";
      }
    }
  } else {
    throw new Error("Correction target unavailable.");
  }
  const checkedMap = parseWorkMap(map, base.evidence, transcript);
  const version: ProcessVersion = {
    ...structuredClone(base),
    id: input.versionId,
    number: process.versions.length + 1,
    basedOnVersionId: base.id,
    createdAt: input.now,
    reviewedAt: undefined,
    kind: "revision",
    revisionNote: "Manual expert correction; not yet reapproved.",
    editedStepIds: [...new Set([...(base.editedStepIds ?? []), stepId])],
    transcript,
    workMap: checkedMap,
    privacy: input.scanReport ? {
      ...base.privacy,
      redactions: (base.privacy?.redactions ?? 0) + input.scanReport.redactions,
      status: input.scanReport.redactions || base.privacy?.status === "redaction applied"
        ? "redaction applied" : "privacy scan passed",
    } : base.privacy,
  };
  return { ...process, updatedAt: input.now, versions: [...process.versions, version] };
}

export function referenceVersion(
  process: RecordedProcess,
  ownerId: string,
  versionId: string,
): ProcessVersion {
  if (process.ownerId !== ownerId)
    throw new Error("Process unavailable for this profile.");
  const version = process.versions.find((item) => item.id === versionId);
  if (!version) throw new Error("Reference version unavailable.");
  return version;
}

/** Expert approval applies to one immutable map version only. */
export function approveWorkMapVersion(
  process: RecordedProcess,
  ownerId: string,
  versionId: string,
  now: string,
): RecordedProcess {
  const version = referenceVersion(process, ownerId, versionId);
  if (!version.workMap) throw new Error("A process map is required before approval.");
  if (version.privacy?.engine !== "presidio" || version.privacy.imagesWithheld)
    throw new Error("Privacy review incomplete. This version cannot yet be approved for Remy.");
  if (version.reviewedAt) return process;
  return {
    ...process,
    updatedAt: now,
    versions: process.versions.map((item) =>
      item.id === versionId ? { ...item, reviewedAt: now } : item,
    ),
  };
}

export function renameRecordedProcess(
  process: RecordedProcess,
  ownerId: string,
  title: string,
): RecordedProcess {
  if (process.ownerId !== ownerId) throw new Error("Process unavailable.");
  if (!title.trim() || title.trim().length > 120)
    throw new Error("Enter a name of 1–120 characters.");
  return {
    ...process,
    title: title.trim(),
    updatedAt: new Date().toISOString(),
  };
}

/** Attach a derived draft once; never alter captured sources, approved maps or a user's rename. */
export function attachDraftMap(
  process: RecordedProcess,
  ownerId: string,
  versionId: string,
  expectedTitle: string,
  value: unknown,
): RecordedProcess {
  const version = referenceVersion(process, ownerId, versionId);
  if (version.workMap || version.reviewedAt) return process;
  const workMap = parseWorkMap(
    value,
    version.evidence,
    version.transcript ?? [],
  );
  return {
    ...process,
    title: process.title === expectedTitle ? workMap.title : process.title,
    updatedAt: new Date().toISOString(),
    versions: process.versions.map((v) =>
      v.id === versionId ? { ...v, workMap, summary: workMap.summary } : v,
    ),
  };
}
