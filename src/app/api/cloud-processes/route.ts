import "server-only";
import { backupCloudProcess, cloudConfigured, deleteCloudProcess, listCloudProcesses, validCloudProcess } from "../../../server/cloud-processes";

export const runtime = "nodejs";
// Explicit opt-in enables the single-owner hackathon deployment without ever
// exposing the Supabase secret to the browser. Keep it off by default.
const cloudEnabled = process.env.NODE_ENV === "development" || process.env.SUPABASE_AUTO_SYNC === "true";
const allowedOrigins = [
  "http://127.0.0.1:3000", "http://localhost:3000",
  "http://127.0.0.1:3100", "http://localhost:3100",
  ...(process.env.PUBLIC_BASE_URL ? [process.env.PUBLIC_BASE_URL.replace(/\/$/, "")] : []),
];
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const safeError = (cause: unknown, fallback: string) =>
  cause instanceof Error && /^cloud_[a-z_]+$/.test(cause.message) ? cause.message : fallback;
function sameOrigin(req: Request) {
  return allowedOrigins.includes(req.headers.get("origin") ?? "") && req.headers.get("sec-fetch-site") !== "cross-site";
}
async function readBoundedJson(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 20_000_000) { await reader.cancel(); throw new Error("too_large"); }
    parts.push(value);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export async function GET(req: Request) {
  if (!cloudEnabled) return reply({ error: "cloud_unavailable_in_public_demo" }, 403);
  if (!cloudConfigured()) return reply({ error: "cloud_not_configured" }, 503);
  try { return reply({ processes: await listCloudProcesses() }); }
  catch { return reply({ error: "cloud_load_failed" }, 503); }
}

export async function POST(req: Request) {
  if (!cloudEnabled) return reply({ error: "cloud_unavailable_in_public_demo" }, 403);
  if (!sameOrigin(req)) return reply({ error: "invalid_origin" }, 403);
  if (!cloudConfigured()) return reply({ error: "cloud_not_configured" }, 503);
  if (!req.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "invalid_request" }, 415);
  let process: unknown;
  try { process = await readBoundedJson(req); }
  catch { return reply({ error: "invalid_request" }, 400); }
  if (!validCloudProcess(process)) return reply({ error: "cloud_privacy_or_shape_required" }, 422);
  try { await backupCloudProcess(process); return reply({ ok: true, id: process.id }); }
  catch (cause) { return reply({ error: safeError(cause, "cloud_backup_failed") }, 503); }
}

export async function DELETE(req: Request) {
  if (!cloudEnabled) return reply({ error: "cloud_unavailable_in_public_demo" }, 403);
  if (!sameOrigin(req)) return reply({ error: "invalid_origin" }, 403);
  if (!cloudConfigured()) return reply({ error: "cloud_not_configured" }, 503);
  let body: unknown;
  try { body = await readBoundedJson(req); }
  catch { return reply({ error: "invalid_request" }, 400); }
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string")
    return reply({ error: "invalid_request" }, 400);
  try { await deleteCloudProcess(body.id); return reply({ ok: true }); }
  catch (cause) { return reply({ error: safeError(cause, "cloud_delete_failed") }, 503); }
}
