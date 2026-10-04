import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendRecording,
  CURRENT_USER,
  displayExpertName,
  referenceVersion,
  mergeRecordedProcesses,
  reviseProcessStep,
  correctExpertRule,
  approveWorkMapVersion,
  type RecordingInput,
} from "./processes.ts";
import { checkInvoiceBeforeSave, deriveInvoiceRules } from "./learned-invoice-rules.ts";
const input: RecordingInput = {
  processId: "process-1",
  versionId: "v1",
  owner: CURRENT_USER,
  title: " Rechnung prüfen ",
  summary: "Manuell erklärt",
  evidence: [
    {
      id: "frame-1",
      image: "data:image/jpeg;base64,test",
      time: "20:00:00",
      capturedAt: "2026-10-03T18:00:00Z",
      note: "Grund prüfen",
    },
  ],
  basedOnVersionId: null,
  now: "2026-10-03T18:00:00Z",
};
test("recorded process belongs to the demo profile and is not falsely confirmed", () => {
  const result = appendRecording(undefined, input);
  assert.equal(result.ownerId, CURRENT_USER.id);
  assert.equal(result.title, "Rechnung prüfen");
  assert.equal(result.versions[0].status, "recorded");
  assert.deepEqual(result.conflicts, []);
});
test("legacy recordings keep their owner ID but show the demo profile", () => {
  assert.equal(displayExpertName({ id: "local-demo-user", name: "Demo-User" }), "Demo-User");
  assert.equal(displayExpertName({ id: "synthetic-demo", name: "Fictional expert" }), "Fictional expert");
});
test("new run retains explicit version lineage and does not mutate earlier evidence", () => {
  const first = appendRecording(undefined, input);
  const original = JSON.stringify(first);
  const second = appendRecording(first, {
    ...input,
    versionId: "v2",
    basedOnVersionId: "v1",
    summary: "Ausnahme erklärt",
  });
  assert.equal(JSON.stringify(first), original);
  assert.equal(second.versions.length, 2);
  assert.equal(second.versions[1].basedOnVersionId, "v1");
  assert.equal(second.versions[0].summary, "Manuell erklärt");
  assert.equal(
    appendRecording(second, {
      ...input,
      versionId: "v2",
      basedOnVersionId: "v1",
    }),
    second,
  );
});
test("missing reference and another profile cannot be used", () => {
  const first = appendRecording(undefined, input);
  assert.throws(() =>
    appendRecording(undefined, { ...input, basedOnVersionId: "deleted" }),
  );
  assert.throws(() =>
    appendRecording(first, { ...input, owner: { id: "other", name: "Other" } }),
  );
  assert.throws(() => referenceVersion(first, "other", "v1"));
  assert.throws(() => referenceVersion(first, CURRENT_USER.id, "missing"));
});
test("empty and invalid recordings cannot become saved processes", () => {
  assert.throws(() => appendRecording(undefined, { ...input, evidence: [] }));
  assert.throws(() => appendRecording(undefined, { ...input, title: " " }));
  assert.throws(() =>
    appendRecording(undefined, {
      ...input,
      evidence: [
        { ...input.evidence[0], image: "https://example.com/private" },
      ],
    }),
  );
});

test("explicit merge preserves all evidence, original labels and independent lineage", () => {
  const first = appendRecording(undefined, input);
  const second = appendRecording(undefined, { ...input, processId: "p2", versionId: "v2", title: "Same process another name" });
  const before = JSON.stringify([first, second]);
  const merged = mergeRecordedProcesses(first, second, CURRENT_USER.id, input.now);
  assert.equal(merged.versions.length, 2);
  assert.equal(merged.versions[1].origin?.title, second.title);
  assert.equal(merged.versions[1].basedOnVersionId, null);
  assert.equal(JSON.stringify([first, second]), before);
  assert.throws(() => mergeRecordedProcesses(first, second, "other", input.now));
  assert.throws(() => mergeRecordedProcesses(first, first, CURRENT_USER.id, input.now));
  assert.throws(() => mergeRecordedProcesses(first, { ...second, versions: first.versions }, CURRENT_USER.id, input.now));
});

test("voice recordings need real user transcript, never fake images; correction appends a version", () => {
  const utterance = { id: "u1", role: "user" as const, text: "I create a quote in Notion.", at: input.now };
  const map = { title: "Quote", summary: "Create quote", steps: [{ id: "s1", title: "Create quote", action: "Create in Notion", applications: ["Notion"], frameId: "", utteranceId: "u1", quote: utterance.text, provenance: "explained" as const, reason: "", decision: "" }], edges: [], guardrails: [], questions: [] };
  const voice = { ...input, recordingMode: "voice" as const, evidence: [], transcript: [utterance], workMap: map };
  assert.throws(() => appendRecording(undefined, { ...voice, transcript: [] }));
  assert.throws(() => appendRecording(undefined, { ...voice, transcript: [{ ...utterance, role: "agent" }] }));
  const first = appendRecording(undefined, voice), before = JSON.stringify(first);
  const edit = { baseVersionId: "v1", stepId: "s1", title: "Review quote", action: "Review in Outlook", note: "Corrected step", versionId: "v2", now: input.now };
  const revised = reviseProcessStep(first, CURRENT_USER.id, edit);
  assert.equal(revised.versions.length, 2);
  assert.equal(JSON.stringify(first), before);
  assert.equal(revised.versions[1].basedOnVersionId, "v1");
  assert.equal(revised.versions[1].kind, "revision");
  assert.deepEqual(revised.versions[1].editedStepIds, ["s1"]);
  assert.deepEqual(revised.versions[1].transcript, first.versions[0].transcript);
  assert.equal(revised.versions[1].workMap?.steps[0].quote, utterance.text);
  assert.equal(revised.versions[1].reviewedAt, undefined);
  assert.equal(reviseProcessStep(revised, CURRENT_USER.id, edit), revised);
  assert.throws(() => reviseProcessStep(first, "other", edit));
  assert.throws(() => reviseProcessStep(first, CURRENT_USER.id, { ...edit, note: "" }));
});

test("typed expert correction appends an unapproved sourced version and changes a learned rule", () => {
  const original = "Equipment over €5,000 is always capex.";
  const corrected = "Equipment over €8,000 is always capex.";
  const base = appendRecording(undefined, {
    ...input,
    title: "Synthetic equipment process",
    transcript: [{ id: "u1", role: "user", text: original, at: input.now }],
    privacy: { engine: "presidio", status: "privacy scan passed", redactions: 0, imagesWithheld: 0, policy: "text-v1" },
    workMap: { title: "Synthetic equipment process", summary: "Choose account",
      steps: [{ id: "s1", title: "Choose account", action: "Select the account", applications: ["Demo ERP"],
        decision: "", reason: original, provenance: "observed", frameId: "frame-1", utteranceId: "u1", quote: original }],
      guardrails: [{ rule: original, stepId: "s1", frameId: "frame-1", utteranceId: "u1", quote: original }],
      edges: [], questions: [] },
  });
  const approved = approveWorkMapVersion(base, CURRENT_USER.id, "v1", input.now);
  const before = JSON.stringify(approved);
  const revised = correctExpertRule(approved, CURRENT_USER.id, {
    baseVersionId: "v1", target: "guardrail:0", statement: corrected,
    versionId: "v2", now: "2026-10-04T03:00:00Z",
  });
  assert.equal(JSON.stringify(approved), before);
  assert.equal(revised.versions.length, 2);
  assert.equal(revised.versions[0].reviewedAt, input.now);
  assert.equal(revised.versions[1].reviewedAt, undefined);
  assert.equal(revised.versions[1].workMap?.guardrails[0].quote, corrected);
  assert.equal(revised.versions[1].workMap?.steps[0].quote, corrected);
  assert.equal(revised.versions[1].transcript?.at(-1)?.text, corrected);
  assert.equal(revised.versions[1].workMap?.steps[0].provenance, "explained");
  const invoice = { amount: 7200, category: "expense" as const, assetNumber: "", equipment: true };
  assert.equal(checkInvoiceBeforeSave(deriveInvoiceRules(approved.versions[0].workMap!), invoice).status, "blocked");
  assert.equal(checkInvoiceBeforeSave(deriveInvoiceRules(revised.versions[1].workMap!), invoice).status, "clear");
  assert.throws(() => correctExpertRule(base, CURRENT_USER.id, {
    baseVersionId: "v1", target: "guardrail:9", statement: corrected,
    versionId: "v3", now: input.now,
  }));
});
