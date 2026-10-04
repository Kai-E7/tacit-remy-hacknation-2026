import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PDFDocument,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { createProcessHandbook } from "./process-handbook.ts";
import type { RecordedProcess, ProcessVersion } from "./processes.ts";

const at = "2026-10-04T09:12:00Z";
// Deliberately synthetic one-pixel PNG. No captured user media in test sources.
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

function fixture(count = 2): RecordedProcess {
  const version: ProcessVersion = {
    id: "selected-version",
    number: 2,
    basedOnVersionId: "prior-version",
    createdAt: at,
    recordedBy: { id: "local-demo-user", name: "Demo-User" },
    status: "recorded",
    summary: "Ausgewählte Beschreibung für die Übergabe.",
    evidence: [
      {
        id: "selected-frame",
        image: pixel,
        time: "09:12",
        capturedAt: at,
        note: "synthetic",
      },
    ],
    transcript: [
      {
        id: "selected-utterance",
        role: "user",
        text: "Ich prüfe Größe und Zuständigkeit. Die Freigabe muss vorliegen.",
        at,
      },
    ],
    workMap: {
      title: "Übergabe prüfen",
      summary: "Ausgewählte Beschreibung für die Übergabe.",
      steps: Array.from({ length: count }, (_, i) => ({
        id: `step-${i}`,
        title: `Vorgang ${i + 1} prüfen`,
        action: "Größe und Zuständigkeit prüfen.",
        applications: i === 0 ? ["Outlook"] : [],
        ...(i === 0
          ? {
              actor: {
                name: "Sachbearbeitung",
                utteranceId: "selected-utterance",
                quote: "Ich prüfe Größe und Zuständigkeit.",
              },
            }
          : {}),
        reason: "Damit die Freigabe vorliegt.",
        decision: i === 0 ? "Liegt die Freigabe vor?" : "",
        frameId: "selected-frame",
        utteranceId: "selected-utterance",
        quote: "Ich prüfe Größe und Zuständigkeit.",
        provenance: "observed" as const,
      })),
      edges: Array.from({ length: count - 1 }, (_, i) => ({
        from: `step-${i}`,
        to: `step-${i + 1}`,
        label: "Freigabe liegt vor",
      })),
      guardrails: [
        {
          stepId: "step-0",
          rule: "Freigabe prüfen.",
          frameId: "selected-frame",
          utteranceId: "selected-utterance",
          quote: "Die Freigabe muss vorliegen.",
        },
      ],
      questions: ["Wer vertritt die Sachbearbeitung?"],
    },
  };
  const other: ProcessVersion = {
    ...structuredClone(version),
    id: "prior-version",
    number: 1,
    summary: "OTHER_VERSION_SECRET",
    transcript: [
      {
        id: "private-utterance",
        role: "user",
        text: "OTHER_VERSION_SECRET",
        at,
      },
    ],
    evidence: [
      {
        id: "private-frame",
        image: "OTHER_VERSION_IMAGE",
        time: "private",
        capturedAt: at,
        note: "private",
      },
    ],
    workMap: {
      ...structuredClone(version.workMap!),
      title: "OTHER_VERSION_SECRET",
      summary: "OTHER_VERSION_SECRET",
    },
  };
  return {
    schemaVersion: 1,
    id: "process",
    ownerId: "local-demo-user",
    title: "Renamed current title",
    createdAt: at,
    updatedAt: at,
    versions: [other, version],
    conflicts: [],
  };
}

async function inspect(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const texts: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const operators = new TextDecoder().decode(
        decodePDFRawStream(stream).decode(),
      );
      for (const match of operators.matchAll(/<([\da-f]+)>\s*Tj/gi)) {
        texts.push(
          new TextDecoder("windows-1252").decode(
            Uint8Array.from(match[1].match(/../g)!, (hex) => parseInt(hex, 16)),
          ),
        );
      }
    }
  }
  return {
    doc,
    text: texts.join("\n"),
    compact: texts.join(" ").replace(/\s+/g, " "),
  };
}

test("handbook is A4 landscape-first PDF scoped to the selected immutable version", async () => {
  const process = fixture(),
    before = structuredClone(process);
  const bytes = await createProcessHandbook(process, "selected-version");
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const { doc, text } = await inspect(bytes);
  assert.equal(doc.getPageCount(), 4); // Overview, two steps + distinct rule-source continuation.
  assert.deepEqual(doc.getPage(0).getSize(), { width: 841.89, height: 595.28 });
  for (const value of [
    "Übergabe prüfen",
    "DRAFT",
    "selected-version",
    "selected-frame",
    "selected-utterance",
    "2026-10-04 09:12:00 UTC",
    "Outlook",
    "MUST / BOUNDARY",
    "Größe",
    "Unknown",
  ])
    assert.ok(text.includes(value), value);
  assert.ok(!text.includes("OTHER_VERSION_SECRET"));
  assert.ok(!text.includes("private-frame"));
  assert.equal(doc.getTitle(), "Renamed current title - Version 2");
  assert.ok(text.includes("Renamed current title"));
  assert.ok(text.includes("ORIGINAL PROCESS MAP TITLE"));
  assert.ok(
    text.indexOf("selected-frame") < text.indexOf("\nACTION\n"),
    "screenshot source precedes mapped action",
  );
  assert.deepEqual(process, before);
  assert.ok(
    doc
      .getPages()
      .some((page) => page.node.Resources()?.toString().includes("XObject")),
    "actual selected image is embedded",
  );
});

test("short three-step handbook stays at four pages without duplicate quote or boilerplate pages", async () => {
  const process = fixture(3),
    version = process.versions[1],
    map = version.workMap!;
  map.questions = [];
  map.steps[0].quote = version.transcript![0].text;
  const { doc, text } = await inspect(
    await createProcessHandbook(process, version.id),
  );
  assert.equal(doc.getPageCount(), 4);
  assert.ok(!text.includes("Context & Sources"));
  assert.ok(!text.includes("RESPONSIBILITY SOURCE"));
  assert.ok(text.includes("MUST / BOUNDARY - DRAFT RULE"));
  assert.ok(text.includes("Die Freigabe muss vorliegen."));
  assert.ok(text.includes("Boundary source: selected-utterance"));
});

test("missing versions, maps and cross-version quote references fail visibly", async () => {
  const process = fixture();
  await assert.rejects(
    createProcessHandbook(process, "missing"),
    /selected version is unavailable/,
  );
  process.versions[1].workMap!.steps[0].utteranceId = "private-utterance";
  await assert.rejects(
    createProcessHandbook(process, "selected-version"),
    /missing sources/,
  );
  delete process.versions[1].workMap;
  await assert.rejects(
    createProcessHandbook(process, "selected-version"),
    /does not have a process map yet/,
  );
});

test("voice explanations, historic revisions and bad JPEGs are explicitly labelled", async () => {
  const process = fixture(1),
    version = process.versions[1];
  version.evidence[0].image = "data:image/jpeg;base64,YmFk";
  version.kind = "revision";
  version.editedStepIds = ["step-0"];
  version.workMap!.steps[0].provenance = "explained";
  const { compact } = await inspect(
    await createProcessHandbook(process, version.id),
  );
  assert.match(compact, /Image unavailable/);
  assert.match(compact, /MANUALLY REVISED/);
  assert.match(compact, /not necessarily the updated action/);
  assert.match(compact, /TRANSCRIPT SOURCE/);
  version.recordingMode = "voice";
  version.evidence = [];
  version.workMap!.steps[0].frameId = "";
  version.workMap!.guardrails[0].frameId = "";
  const voice = await inspect(await createProcessHandbook(process, version.id));
  assert.match(voice.compact, /No screen capture for this step/);
  assert.match(voice.compact, /selected-utterance/);
});

test("20 steps retain full long paragraphs and unsupported glyphs cannot abort export", async () => {
  const process = fixture(20),
    version = process.versions[1],
    map = version.workMap!;
  const summary =
    `${"Übergabe und Größe prüfen. ".repeat(80)}`.slice(0, 1975) +
    " SUMMARY_END";
  const longQuote =
    `${"Ich prüfe die Freigabe sorgfältig. ".repeat(125)}`.slice(0, 3975) +
    " QUOTE_END";
  map.summary = summary;
  version.summary = summary;
  version.transcript!.push({
    id: "long-quote",
    role: "user",
    text: longQuote,
    at,
  });
  map.steps.forEach((step, i) => {
    step.title =
      `${i + 1} ${"ÜbermäßigLangerUngetrennterTitel".repeat(5)}`.slice(0, 160);
    step.action =
      `${"UngetrennterVorgang".repeat(78)}`.slice(0, 1470) + ` ACTION_END_${i}`;
    step.quote = longQuote;
    step.utteranceId = "long-quote";
  });
  map.questions = ["Prüfung 🙂 漢字 → bestätigen?"];
  const { doc, compact } = await inspect(
    await createProcessHandbook(process, version.id),
  );
  assert.ok(doc.getPageCount() > 23 && doc.getPageCount() < 150);
  assert.match(compact, /SUMMARY_END/);
  assert.equal((compact.match(/QUOTE_END/g) ?? []).length, 20);
  for (let i = 0; i < 20; i++) assert.ok(compact.includes(`ACTION_END_${i}`));
  assert.match(compact, /Prüfung \? \?\? -> bestätigen/);
});

test("export snapshots the selected version before asynchronous font and image work", async () => {
  const process = fixture(1);
  const result = createProcessHandbook(process, "selected-version");
  process.title = "LATE_TITLE_MUTATION";
  process.versions[1].workMap!.summary = "LATE_MUTATION";
  process.versions[1].transcript![0].text = "LATE_MUTATION";
  const { doc, text } = await inspect(await result);
  assert.ok(!text.includes("LATE_MUTATION"));
  assert.ok(!text.includes("LATE_TITLE_MUTATION"));
  assert.equal(doc.getTitle(), "Renamed current title - Version 2");
});
