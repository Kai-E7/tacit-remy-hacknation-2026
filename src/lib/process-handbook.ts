import {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
  type PDFFont,
  type PDFPage,
  type PDFImage,
} from "pdf-lib";
import type { RecordedProcess, ProcessVersion, Evidence } from "./processes.ts";
import { parseWorkMap, type Source, type WorkMap } from "./work-map.ts";
import {
  layoutProcessFlow,
  stepApplications,
  NODE_WIDTH,
  NODE_HEIGHT,
} from "./process-flow.ts";

const A4 = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] } as const;
const M = 38;
const C = {
  paper: rgb(0.969, 0.957, 0.933),
  white: rgb(1, 0.996, 0.984),
  ink: rgb(0.137, 0.235, 0.204),
  muted: rgb(0.384, 0.427, 0.392),
  line: rgb(0.84, 0.865, 0.82),
  sage: rgb(0.925, 0.941, 0.898),
  amber: rgb(0.47, 0.34, 0.13),
  amberBg: rgb(0.988, 0.955, 0.875),
};

type Fonts = { body: PDFFont; bold: PDFFont; title: PDFFont };

/** WinAnsi preserves supported Latin text; unsupported scripts/emoji are explicitly substituted. */
function textEncoder(font: PDFFont) {
  const cache = new Map<string, string>();
  return (value: string): string =>
    Array.from(
      value
        .normalize("NFC")
        .replace(/[\u2010-\u2015\u2212]/g, "-")
        .replace(/\u2192/g, " -> ")
        .replace(/\u2190/g, " <- ")
        .replace(/\r\n?/g, "\n")
        .replace(/\t/g, "  ")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""),
      (char) => {
        if (char === "\n") return char;
        if (!cache.has(char)) {
          try {
            font.encodeText(char);
            cache.set(char, char);
          } catch {
            cache.set(char, "?");
          }
        }
        return cache.get(char)!;
      },
    ).join("");
}

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      // Break even unspaced IDs/URLs without dropping characters or exceeding the margin.
      for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

function short(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}...` : text;
}

function date(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? `${value} (time unavailable)`
    : parsed
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC");
}

class Pages {
  page!: PDFPage;
  y = 0;
  section = "";
  clean: (text: string) => string;
  readonly doc: PDFDocument;
  readonly fonts: Fonts;
  readonly version: ProcessVersion;
  constructor(doc: PDFDocument, fonts: Fonts, version: ProcessVersion) {
    this.doc = doc;
    this.fonts = fonts;
    this.version = version;
    this.clean = textEncoder(fonts.body);
  }
  add(section: string, landscape = false) {
    this.section = section;
    const dimensions = landscape ? A4.landscape : A4.portrait;
    this.page = this.doc.addPage([...dimensions]);
    const { width, height } = this.page.getSize();
    this.page.drawRectangle({ x: 0, y: 0, width, height, color: C.paper });
    this.page.drawText("Tacit", {
      x: M,
      y: height - 29,
      font: this.fonts.title,
      size: 16,
      color: C.ink,
    });
    this.page.drawText(this.clean(short(section, 74)), {
      x: M + 66,
      y: height - 26,
      size: 8,
      font: this.fonts.body,
      color: C.muted,
    });
    this.page.drawLine({
      start: { x: M, y: height - 39 },
      end: { x: width - M, y: height - 39 },
      color: C.line,
      thickness: 0.6,
    });
    this.y = height - 60;
  }
  get width() {
    return this.page.getWidth() - M * 2;
  }
  ensure(height: number) {
    if (this.y - height < 53)
      this.add(`${this.section.replace(/ - Continued$/, "")} - Continued`);
  }
  paragraph(
    value: string,
    options: {
      size?: number;
      bold?: boolean;
      title?: boolean;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      after?: number;
    } = {},
  ) {
    const size = options.size ?? 10.5;
    const font = options.title
      ? this.fonts.title
      : options.bold
        ? this.fonts.bold
        : this.fonts.body;
    const indent = options.indent ?? 0;
    const leading = size * 1.48;
    const lines = wrap(this.clean(value), font, size, this.width - indent * 2);
    for (const line of lines) {
      this.ensure(leading);
      this.page.drawText(line, {
        x: M + indent,
        y: this.y - size,
        font,
        size,
        color: options.color ?? C.ink,
      });
      this.y -= leading;
    }
    this.y -= options.after ?? 8;
  }
  label(value: string, amber = false) {
    this.ensure(46);
    this.paragraph(value, {
      size: 8.5,
      bold: true,
      color: amber ? C.amber : C.muted,
      after: 5,
    });
  }
  field(label: string, value: string, amber = false) {
    this.label(label, amber);
    this.paragraph(value);
  }
  notice(value: string) {
    const lines = wrap(
      this.clean(value),
      this.fonts.body,
      9.5,
      this.width - 24,
    );
    const height = lines.length * 14 + 20;
    // Notices are short fixed product copy, not unbounded captured text.
    this.ensure(height + 10);
    this.page.drawRectangle({
      x: M,
      y: this.y - height,
      width: this.width,
      height,
      color: C.amberBg,
    });
    lines.forEach((line, i) =>
      this.page.drawText(line, {
        x: M + 12,
        y: this.y - 17 - i * 14,
        size: 9.5,
        font: this.fonts.body,
        color: C.amber,
      }),
    );
    this.y -= height + 14;
  }
  finish() {
    const pages = this.doc.getPages();
    pages.forEach((page, index) => {
      page.drawLine({
        start: { x: M, y: 39 },
        end: { x: page.getWidth() - M, y: 39 },
        color: C.line,
        thickness: 0.6,
      });
      page.drawText(
        `DRAFT - expert review required | Version ${this.version.number}`,
        { x: M, y: 25, size: 8, font: this.fonts.body, color: C.amber },
      );
      const number = `${index + 1} / ${pages.length}`;
      page.drawText(number, {
        x: page.getWidth() - M - this.fonts.body.widthOfTextAtSize(number, 8),
        y: 25,
        size: 8,
        font: this.fonts.body,
        color: C.muted,
      });
    });
  }
}

function diagram(book: Pages, map: WorkMap) {
  const layout = layoutProcessFlow(map, 1000, 650);
  const points = [
    ...layout.nodes.flatMap((n) => [
      n.position,
      { x: n.position.x + NODE_WIDTH, y: n.position.y + NODE_HEIGHT },
    ]),
    ...layout.edges.flatMap((e) => [...e.points, e.labelPosition]),
  ];
  const minX = Math.min(0, ...points.map((p) => p.x)) - 20;
  const minY = Math.min(0, ...points.map((p) => p.y)) - 20;
  const maxX = Math.max(...points.map((p) => p.x)) + 20;
  const maxY = Math.max(...points.map((p) => p.y)) + 20;
  const sceneWidth = maxX - minX,
    sceneHeight = maxY - minY;
  const draw = (
    x: number,
    top: number,
    width: number,
    height: number,
    scale: number,
    originX: number,
    originY: number,
    detail = false,
  ) => {
    const page = book.page;
    const X = (v: number) => x + (v - originX) * scale;
    const Y = (v: number) => top - (v - originY) * scale;
    page.pushOperators(
      pushGraphicsState(),
      rectangle(x, top - height, width, height),
      clip(),
      endPath(),
    );
    for (const edge of layout.edges) {
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1],
          b = edge.points[i];
        page.drawLine({
          start: { x: X(a.x), y: Y(a.y) },
          end: { x: X(b.x), y: Y(b.y) },
          color: C.muted,
          thickness: 1.6 * scale,
        });
      }
      const end = edge.points.at(-1)!,
        before = edge.points.at(-2)!;
      const angle = Math.atan2(end.y - before.y, end.x - before.x);
      for (const side of [-1, 1])
        page.drawLine({
          start: { x: X(end.x), y: Y(end.y) },
          end: {
            x: X(end.x - 10 * Math.cos(angle + side * 0.45)),
            y: Y(end.y - 10 * Math.sin(angle + side * 0.45)),
          },
          color: C.muted,
          thickness: 1.6 * scale,
        });
      if (
        edge.label &&
        (!detail ||
          (edge.labelPosition.y - 17 >= originY &&
            edge.labelPosition.y + 5 <= originY + height / scale))
      ) {
        let label = book.clean(short(edge.label, 28));
        if (book.fonts.body.widthOfTextAtSize(label, 11) > 80) {
          while (
            label &&
            book.fonts.body.widthOfTextAtSize(`${label}...`, 11) > 80
          )
            label = label.slice(0, -1);
          label += "...";
        }
        const labelWidth = book.fonts.body.widthOfTextAtSize(label, 11) * scale;
        page.drawRectangle({
          x: X(edge.labelPosition.x) - labelWidth / 2 - 4 * scale,
          y: Y(edge.labelPosition.y) + 5 * scale,
          width: labelWidth + 8 * scale,
          height: 17 * scale,
          color: C.paper,
        });
        page.drawText(label, {
          x: X(edge.labelPosition.x) - labelWidth / 2,
          y: Y(edge.labelPosition.y) + 9 * scale,
          size: 11 * scale,
          font: book.fonts.body,
          color: C.muted,
        });
      }
    }
    for (const node of layout.nodes) {
      const index = map.steps.findIndex((s) => s.id === node.id),
        step = map.steps[index];
      const nx = node.position.x,
        ny = node.position.y;
      // Detail pages never slice a node title: edge continuations alone may cross a tile boundary.
      if (
        detail &&
        (nx < originX ||
          ny < originY ||
          nx + NODE_WIDTH > originX + width / scale ||
          ny + NODE_HEIGHT > originY + height / scale)
      )
        continue;
      page.drawRectangle({
        x: X(nx),
        y: Y(ny + NODE_HEIGHT),
        width: NODE_WIDTH * scale,
        height: NODE_HEIGHT * scale,
        color: step.decision ? C.amberBg : C.white,
        borderColor: C.line,
        borderWidth: 1.2 * scale,
      });
      const nodeText = (
        text: string,
        topOffset: number,
        size: number,
        bold = false,
        limit = 2,
      ) => {
        const font = bold ? book.fonts.bold : book.fonts.body;
        const lines = wrap(book.clean(text), font, size, NODE_WIDTH - 28);
        lines.slice(0, limit).forEach((line, i) => {
          let shown = line;
          if (i === limit - 1 && lines.length > limit) {
            while (
              shown &&
              font.widthOfTextAtSize(`${shown}...`, size) > NODE_WIDTH - 28
            )
              shown = shown.slice(0, -1);
            shown += "...";
          }
          page.drawText(shown, {
            x: X(nx + 14),
            y: Y(ny + topOffset + i * size * 1.3),
            font,
            size: size * scale,
            color: C.ink,
          });
        });
      };
      nodeText(
        `${String(index + 1).padStart(2, "0")}  ${step.decision ? "DECISION" : "STEP"}`,
        25,
        11,
        true,
        1,
      );
      nodeText(step.title, 56, 18, true, 3);
      nodeText(
        `App: ${
          stepApplications(step)
            .map((a) => a.name)
            .join(", ") || "Unknown"
        }`,
        137,
        12,
        false,
        2,
      );
      nodeText(
        `Role: ${step.actor?.name.trim() || "Unknown"}`,
        180,
        11,
        false,
        1,
      );
    }
    page.pushOperators(popGraphicsState());
  };
  const height = book.y - 83;
  const scale = Math.min(book.width / sceneWidth, height / sceneHeight, 1);
  draw(
    M + (book.width - sceneWidth * scale) / 2,
    book.y,
    book.width,
    height,
    scale,
    minX,
    minY,
  );
  book.y = 73;
  book.paragraph(
    "Arrows follow saved connections. Numbers match the step pages; diagram labels may be shortened.",
    { size: 8, after: 0 },
  );

  // Large graphs stay fully visible on the overview and get readable vector tiles.
  if (scale < 0.55) {
    const zoom = 0.65,
      viewportWidth = (A4.landscape[0] - 2 * M) / zoom;
    const viewportHeight = 410 / zoom;
    const starts = (coordinates: number[], viewport: number, size: number) => {
      const sorted = [...new Set(coordinates)].sort((a, b) => a - b),
        result: number[] = [];
      for (let i = 0; i < sorted.length;) {
        const start = sorted[i] - 20;
        result.push(start);
        i++;
        while (i < sorted.length && sorted[i] + size <= start + viewport - 20)
          i++;
      }
      return result;
    };
    const xs = starts(
      layout.nodes.map((n) => n.position.x),
      viewportWidth,
      NODE_WIDTH,
    );
    const ys = starts(
      layout.nodes.map((n) => n.position.y),
      viewportHeight,
      NODE_HEIGHT,
    );
    const tiles = ys
      .flatMap((y) => xs.map((x) => ({ x, y })))
      .filter((t) =>
        layout.nodes.some(
          (n) =>
            n.position.x >= t.x &&
            n.position.x + NODE_WIDTH <= t.x + viewportWidth &&
            n.position.y >= t.y &&
            n.position.y + NODE_HEIGHT <= t.y + viewportHeight,
        ),
      );
    for (const [index, tile] of tiles.entries()) {
      book.add(`Diagram - detail ${index + 1} / ${tiles.length}`, true);
      book.paragraph(`Process detail · area ${index + 1}`, {
        title: true,
        size: 20,
        after: 10,
      });
      draw(M, book.y, book.width, 410, zoom, tile.x, tile.y, true);
      book.y = 67;
      book.paragraph(
        "Detail from the overview: connections may continue beyond this area. Complete transitions appear on the step pages.",
        { size: 8, after: 0 },
      );
    }
  }
}

async function screenshot(
  book: Pages,
  evidence: Evidence | undefined,
  cache: Map<string, PDFImage | null>,
  explanation: string,
) {
  if (!evidence) {
    book.field(
      "SCREEN EVIDENCE",
      "No screen evidence is available in this version.",
    );
    return;
  }
  if (!cache.has(evidence.id)) {
    let image: PDFImage | null = null;
    try {
      if (/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(evidence.image))
        image = await book.doc.embedJpg(evidence.image);
      else if (/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(evidence.image))
        image = await book.doc.embedPng(evidence.image);
    } catch {
      /* Keep the source ID and a visible failure label, never synthesize pixels. */
    }
    cache.set(evidence.id, image);
  }
  const image = cache.get(evidence.id);
  book.label("SCREEN EVIDENCE");
  book.paragraph(
    `${evidence.id} | ${evidence.time} | ${date(evidence.capturedAt)}`,
    { size: 8.5, color: C.muted },
  );
  book.paragraph(explanation, { size: 9, color: C.muted });
  if (!image) {
    book.notice(
      "Image unavailable: the saved image data is invalid or unsupported. No substitute image was generated.",
    );
    return;
  }
  const factor = Math.min(book.width / image.width, 245 / image.height);
  const width = image.width * factor,
    height = image.height * factor;
  book.ensure(height + 20);
  book.page.drawRectangle({
    x: M,
    y: book.y - height - 8,
    width: book.width,
    height: height + 8,
    color: C.white,
    borderColor: C.line,
    borderWidth: 0.6,
  });
  book.page.drawImage(image, {
    x: M + (book.width - width) / 2,
    y: book.y - height - 4,
    width,
    height,
  });
  book.y -= height + 22;
}

function quote(
  book: Pages,
  source: Source,
  version: ProcessVersion,
  title = "TRANSCRIPT SOURCE",
) {
  const utterance = version.transcript?.find(
    (u) =>
      u.id === source.utteranceId &&
      u.role === "user" &&
      source.quote &&
      u.text.includes(source.quote),
  );
  const attribution = utterance
    ? `${version.recordedBy.name} | ${date(utterance.at)} | Source ${utterance.id}`
    : "";
  const attributionLines = wrap(
    book.clean(attribution),
    book.fonts.body,
    8.5,
    book.width,
  ).length;
  const quoteLines = wrap(
    book.clean(`„${source.quote}“`),
    book.fonts.body,
    10.5,
    book.width - 24,
  ).length;
  book.ensure(
    utterance
      ? 18 + attributionLines * 12.58 + 8 + Math.min(2, quoteLines) * 15.54 + 8
      : 60,
  );
  book.label(title);
  if (!utterance) {
    book.paragraph(
      "No verified expert quote is available for this section.",
      { color: C.muted },
    );
    return;
  }
  book.paragraph(attribution, { size: 8.5, color: C.muted });
  book.paragraph(`„${source.quote}“`, { indent: 12 });
}

/** Browser-only export: no fetch, filesystem, provider calls, or mutation of recording history. */
export async function createProcessHandbook(
  process: RecordedProcess,
  versionId: string,
): Promise<Uint8Array> {
  const selected = process.versions.find((version) => version.id === versionId);
  if (!selected)
    throw new Error("The selected version is unavailable.");
  // Snapshot before the first await; later UI edits cannot alter this export.
  const version = structuredClone(selected);
  const processTitle = process.title;
  if (!version.workMap)
    throw new Error("This version does not have a process map yet.");
  let map: WorkMap;
  try {
    map = parseWorkMap(
      version.workMap,
      version.evidence,
      version.transcript ?? [],
    );
  } catch {
    throw new Error(
      "This process map contains invalid or missing sources in the selected version.",
    );
  }
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    body: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    title: await doc.embedFont(StandardFonts.TimesRoman),
  };
  const book = new Pages(doc, fonts, version);
  doc.setTitle(book.clean(`${processTitle} - Version ${version.number}`));
  doc.setAuthor(book.clean(version.recordedBy.name));
  doc.setSubject("Tacit Process Handbook - draft, no activated rules");
  doc.setCreator("Tacit - local PDF export");

  book.add("Process Handbook / Overview", true);
  book.paragraph(processTitle, { title: true, size: 26, after: 8 });
  book.paragraph(
    `${process.demo ? "SYNTHETIC EXAMPLE - no real recording or privacy scan" : "DRAFT - expert review required"} | Version ${version.number} | ${date(version.createdAt)}`,
    { size: 10, bold: true, color: C.amber, after: 6 },
  );
  book.paragraph(
    `${map.steps.length} steps | ${process.demo ? "Mock screenshots" : version.recordingMode === "voice" ? "Voice interview" : "Screen capture"} | ${version.evidence.length} images | ${version.transcript?.length ?? 0} transcript turns`,
    { size: 9, color: C.muted, after: 8 },
  );
  book.paragraph(
    `${short(map.summary, 200)}${map.summary.length > 200 ? " (Full text under Context & Sources.)" : ""}`,
    { size: 10, after: 12 },
  );
  book.paragraph(
    `${process.demo ? "Fictional expert" : "Recorded by"} ${version.recordedBy.name} | Source: ${version.id}${version.basedOnVersionId ? ` | Reference: ${version.basedOnVersionId}` : ""}`,
    { size: 8, color: C.muted, after: 5 },
  );
  if (map.title !== processTitle)
    book.paragraph(`ORIGINAL PROCESS MAP TITLE: ${map.title}`, {
      size: 8,
      color: C.muted,
      after: 5,
    });
  if (version.reviewedAt)
    book.paragraph(
      `Reviewed: ${date(version.reviewedAt)}. No rules activated.`,
      { size: 8, color: C.muted, after: 5 },
    );
  if (version.revisionNote && version.revisionNote.length <= 160)
    book.paragraph(`Revision note: ${version.revisionNote}`, {
      size: 8,
      color: C.muted,
      after: 5,
    });
  diagram(book, map);

  // Additional pages carry actual long source content, never a generic disclaimer.
  const context: [string, string][] = [];
  if (map.summary.length > 200)
    context.push(["PROCESS MAP SUMMARY", map.summary]);
  if (version.summary && version.summary !== map.summary)
    context.push(["RECORDING DESCRIPTION", version.summary]);
  if (version.revisionNote && version.revisionNote.length > 160)
    context.push(["REVISION NOTE", version.revisionNote]);
  if (context.length) {
    book.add("Context & Sources");
    book.paragraph("Additional recording context.", {
      title: true,
      size: 25,
      after: 16,
    });
    for (const [label, value] of context) book.field(label, value);
  }

  const cache = new Map<string, PDFImage | null>();
  for (const [index, step] of map.steps.entries()) {
    book.add(
      `Step ${String(index + 1).padStart(2, "0")} / ${map.steps.length}`,
    );
    book.paragraph(`${String(index + 1).padStart(2, "0")}  ${step.title}`, {
      title: true,
      size: 25,
      after: 14,
    });
    if (version.editedStepIds?.includes(step.id))
      book.notice(
        "MANUALLY REVISED: Historical images and quotes support the earlier recording, not necessarily the updated action.",
      );
    // Put actual source pixels first so long explanations cannot displace them.
    if (step.frameId)
      await screenshot(
        book,
        version.evidence.find((f) => f.id === step.frameId),
        cache,
        process.demo ? "Synthetic mock screenshot. Not a real capture or expert-reviewed source." : version.editedStepIds?.includes(step.id)
          ? "Historical image from the original recording; it does not prove the revised action."
          : step.provenance === "explained"
            ? "Associated screen moment. The described action was explained, not shown."
            : "Saved screen moment from this version.",
      );
    if (step.provenance === "explained" || version.recordingMode === "voice")
      book.paragraph(
        "TRANSCRIPT SOURCE: Explained, not shown as an action on screen.",
        { size: 9, color: C.amber },
      );
    if (!step.frameId)
      book.paragraph(
        "No screen capture for this step. The conversation is the source.",
        { size: 9, color: C.muted },
      );
    book.field("ACTION", step.action);
    book.field(
      "APP / SYSTEM · RESPONSIBILITY",
      `${
        stepApplications(step)
          .map((app) => app.name)
          .join(", ") || "Unknown app"
      } | ${step.actor?.name.trim() || "Responsibility unknown"}`,
    );
    book.field(
      "WHY / TACIT KNOWLEDGE",
      step.reason || "Not yet explained by the expert.",
    );
    if (step.decision) {
      book.field("DECISION / HUMAN CHECK", step.decision, true);
    }
    quote(book, step, version);
    if (
      step.actor?.name &&
      !(
        step.actor.utteranceId === step.utteranceId &&
        step.quote.includes(step.actor.quote)
      )
    )
      quote(
        book,
        { frameId: "", ...step.actor },
        version,
        "RESPONSIBILITY SOURCE",
      );
    for (const rule of map.guardrails.filter((g) => g.stepId === step.id)) {
      book.field("MUST / BOUNDARY - DRAFT RULE", rule.rule, true);
      if (
        rule.utteranceId === step.utteranceId &&
        step.quote.includes(rule.quote)
      )
        book.paragraph(
          `Boundary source: ${rule.utteranceId} - included in the quote above.`,
          { size: 8.5, color: C.muted },
        );
      else quote(book, rule, version, "BOUNDARY SOURCE");
      if (rule.frameId && rule.frameId !== step.frameId)
        await screenshot(
          book,
          version.evidence.find((f) => f.id === rule.frameId),
          cache,
          "Historical source for this boundary; not proof of an activated rule.",
        );
    }
    const outgoing = map.edges.filter((edge) => edge.from === step.id);
    book.label("NEXT / SAVED CONNECTIONS");
    if (!outgoing.length)
      book.paragraph(
        "No outgoing connection is saved. This alone does not confirm that the process ends here.",
        { size: 9, color: C.muted },
      );
    for (const edge of outgoing) {
      const target = map.steps.findIndex((s) => s.id === edge.to);
      book.paragraph(
        `${edge.label || "No condition label"} -> Step ${target + 1}: ${map.steps[target].title}`,
        { size: 9.5 },
      );
    }
  }
  if (map.questions.length) {
    book.ensure(80);
    book.paragraph("Still to clarify.", { title: true, size: 20, after: 12 });
    map.questions.forEach((question, i) =>
      book.field(`QUESTION ${i + 1}`, question),
    );
  }
  book.finish();
  return doc.save();
}
