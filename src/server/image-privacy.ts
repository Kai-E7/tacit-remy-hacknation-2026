import { spawn } from "node:child_process";
import sharp from "sharp";

type Word = { start: number; end: number; left: number; top: number; width: number; height: number };
type Span = { start: number; end: number; entity: string };

export function parseOcrTsv(tsv: string): { text: string; words: Word[] } {
  let text = "";
  let previousLine = "";
  const words: Word[] = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const cells = line.split("\t");
    if (cells.length < 12 || cells[0] !== "5") continue;
    const value = cells.slice(11).join("\t").trim();
    const [left, top, width, height] = cells.slice(6, 10).map(Number);
    if (!value || ![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    const lineKey = cells.slice(1, 5).join(":");
    if (text) text += lineKey === previousLine ? " " : "\n";
    previousLine = lineKey;
    const start = text.length;
    text += value;
    words.push({ start, end: text.length, left, top, width, height });
  }
  return { text, words };
}

async function ocr(image: Buffer, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("tesseract", ["stdin", "stdout", "tsv", "-l", "eng", "--psm", "11"], {
      stdio: ["pipe", "pipe", "ignore"],
      signal,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || size > 1_000_000) reject(new Error("ocr_failed"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(image);
  });
}

export async function redactImage(image: Buffer, config: {
  endpoint?: string;
  token?: string;
  signal?: AbortSignal;
  request?: typeof fetch;
  recognize?: (image: Buffer, signal?: AbortSignal) => Promise<string>;
}): Promise<{ image: Buffer; redactions: number }> {
  if (!config.endpoint) throw new Error("image_scanner_unavailable");
  const url = new URL(config.endpoint);
  if (url.username || url.password || url.search || url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "presidio"].includes(url.hostname))))
    throw new Error("image_scanner_unavailable");
  const metadata = await sharp(image).metadata();
  const width = metadata.width ?? 0, height = metadata.height ?? 0;
  if (metadata.format !== "jpeg" || width < 1 || height < 1 || width > 1920 || height > 1200)
    throw new Error("invalid_image");
  const { text, words } = parseOcrTsv(await (config.recognize ?? ocr)(image, config.signal));
  if (!words.length || text.length > 12000) throw new Error("image_review_required");
  const response = await (config.request ?? fetch)(new URL("/analyze", url), {
    method: "POST", redirect: "error", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
    body: JSON.stringify({ text }),
    signal: AbortSignal.any([...(config.signal ? [config.signal] : []), AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error("image_scanner_unavailable");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("spans" in body) || !Array.isArray(body.spans))
    throw new Error("image_scanner_invalid");
  const spans = body.spans as Span[];
  if (spans.length > 100 || spans.some((s) => !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end > text.length || s.start >= s.end || typeof s.entity !== "string"))
    throw new Error("image_scanner_invalid");
  const mask = words.filter((word) => spans.some((span) => word.start < span.end && word.end > span.start));
  if (spans.length && !mask.length) throw new Error("image_review_required");
  // Re-encode even an unmasked image so EXIF/location metadata never survives.
  if (!mask.length) return { image: await sharp(image).jpeg({ quality: 78 }).toBuffer(), redactions: 0 };
  const rects = mask.map((w) => {
    const x = Math.max(0, w.left - 5), y = Math.max(0, w.top - 5);
    const rectWidth = Math.min(width - x, w.width + 10), rectHeight = Math.min(height - y, w.height + 10);
    return `<rect x="${x}" y="${y}" width="${rectWidth}" height="${rectHeight}" fill="#172923"/>`;
  }).join("");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`);
  const safe = await sharp(image).composite([{ input: overlay }]).jpeg({ quality: 78 }).toBuffer();
  return { image: safe, redactions: mask.length };
}

export function createImagePrivacyHandler(config: {
  authorized(req: Request): boolean;
  origins: string[];
  endpoint?: string;
  token?: string;
  scan?: typeof redactImage;
}) {
  let active = 0;
  const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  return async (req: Request) => {
    if (!config.authorized(req)) return reply({ error: "access_required" }, 401);
    if (req.method !== "POST") return reply({ error: "invalid_method" }, 405);
    if (!config.origins.includes(req.headers.get("origin") ?? "") || req.headers.get("sec-fetch-site") === "cross-site")
      return reply({ error: "origin_not_allowed" }, 403);
    if (!req.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "invalid_request" }, 415);
    if (active >= 4) return reply({ error: "privacy_busy" }, 429);
    active++;
    try {
      const reader = req.body?.getReader();
      if (!reader) return reply({ error: "invalid_request" }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) {
          await reader.cancel();
          return reply({ error: "too_large" }, 413);
        }
        chunks.push(value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof body.image !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.image))
        return reply({ error: "invalid_image" }, 400);
      const source = Buffer.from(body.image.slice("data:image/jpeg;base64,".length), "base64");
      if (!source.length || source.length > 1_500_000) return reply({ error: "too_large" }, 413);
      const result = await (config.scan ?? redactImage)(source, {
        endpoint: config.endpoint, token: config.token, signal: req.signal,
      });
      return reply({ image: `data:image/jpeg;base64,${result.image.toString("base64")}`, redactions: result.redactions, status: result.redactions ? "redaction applied" : "privacy scan passed" });
    } catch {
      return reply({ error: "image_review_required" }, 503);
    } finally {
      active--;
    }
  };
}
