import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { RecordedProcess, ProcessVersion } from "../lib/processes";
import { scanPrivateText } from "./privacy-runtime";
import { redactImage } from "./image-privacy";

const WORKSPACE = "hacknation-synthetic-demo";
const BUCKET = "tacit-evidence";
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const imagePrefix = "data:image/jpeg;base64,";

function config() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) || parsed.pathname !== "/")
      return null;
  } catch { return null; }
  if (!key.startsWith("sb_secret_") && !key.startsWith("eyJ")) return null;
  return { url, key };
}

export function cloudConfigured() { return !!config(); }

function client() {
  const value = config();
  if (!value) throw new Error("cloud_not_configured");
  return createClient(value.url, value.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

/** Public visitors have no user auth. This synthetic-demo backup is local-development only. */
export function validCloudProcess(value: unknown): value is RecordedProcess {
  if (!value || typeof value !== "object") return false;
  const p = value as RecordedProcess;
  if (p.schemaVersion !== 1 || p.demo || p.ownerId !== "local-demo-user" ||
    !idPattern.test(p.id) || typeof p.title !== "string" || p.title.length > 120 ||
    !Array.isArray(p.versions) || p.versions.length < 1 || p.versions.length > 20 ||
    !Array.isArray(p.conflicts) || p.conflicts.length > 100 ||
    typeof p.createdAt !== "string" || typeof p.updatedAt !== "string") return false;
  const ids = new Set<string>();
  for (const version of p.versions) {
    if (!idPattern.test(version.id) || ids.has(version.id) || version.status !== "recorded" ||
      !Number.isInteger(version.number) || version.number < 1 ||
      version.recordedBy?.id !== "local-demo-user" ||
      version.privacy?.engine !== "presidio" || version.privacy.imagesWithheld !== 0 ||
      version.privacy.status === "manual review required" ||
      !Array.isArray(version.evidence) || version.evidence.length > 12) return false;
    ids.add(version.id);
    for (const frame of version.evidence) {
      if (!idPattern.test(frame.id) || typeof frame.image !== "string" || !frame.image.startsWith(imagePrefix) ||
        frame.image.length > 2_700_000 || typeof frame.capturedAt !== "string") return false;
    }
  }
  return true;
}

function objectPath(processId: string, image: string) {
  const hash = createHash("sha256").update(image).digest("hex");
  return `${WORKSPACE}/${processId}/${hash}.jpg`;
}

function processTexts(process: RecordedProcess) {
  const texts = [process.title, ...process.conflicts.flatMap((conflict) => [conflict.question, conflict.resolution ?? ""])];
  for (const version of process.versions) {
    texts.push(version.summary, version.revisionNote ?? "", version.origin?.title ?? "");
    for (const turn of version.transcript ?? []) texts.push(turn.text);
    const map = version.workMap;
    if (!map) continue;
    texts.push(map.title, map.summary, ...map.questions);
    for (const step of map.steps) texts.push(step.title, step.action, step.decision, step.reason, step.quote, step.actor?.name ?? "", ...(step.applications ?? []));
    for (const rule of map.guardrails) texts.push(rule.rule, rule.quote);
  }
  return texts.filter(Boolean);
}

export async function backupCloudProcess(record: RecordedProcess) {
  if (!validCloudProcess(record)) throw new Error("cloud_privacy_or_shape_required");
  // Client scan reports are untrusted. Recheck texts and images on the server
  // before anything crosses the cloud boundary; fail closed if Presidio is down.
  const texts = processTexts(record);
  for (let offset = 0; offset < texts.length; offset += 40) {
    const chunk = texts.slice(offset, offset + 40);
    const checked = await scanPrivateText(chunk);
    if (checked.report.engine !== "presidio" || checked.texts.some((text, index) => text !== chunk[index]))
      throw new Error("cloud_privacy_review_required");
  }
  const db = client();
  const uploaded = new Set<string>();
  const extraRedactions = new Map<string, number>();
  const versions: ProcessVersion[] = [];
  for (const version of record.versions) {
    const evidence = [];
    for (const frame of version.evidence) {
      const path = objectPath(record.id, frame.image);
      if (!uploaded.has(path)) {
        const bytes = Buffer.from(frame.image.slice(imagePrefix.length), "base64");
        if (!bytes.length || bytes.length > 2_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
          throw new Error("cloud_invalid_image");
        let safe: { image: Buffer; redactions: number };
        try {
          safe = await redactImage(bytes, {
            endpoint: process.env.PRESIDIO_URL, token: process.env.PRESIDIO_TOKEN,
          });
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : "";
          throw new Error(["image_review_required", "ocr_failed", "image_scanner_unavailable", "image_scanner_invalid", "invalid_image"].includes(reason)
            ? `cloud_${reason}` : "cloud_image_review_required");
        }
        const { error } = await db.storage.from(BUCKET).upload(path, safe.image, {
          contentType: "image/jpeg", upsert: true, cacheControl: "0",
        });
        if (error) throw new Error("cloud_image_upload_failed");
        extraRedactions.set(path, safe.redactions);
        uploaded.add(path);
      }
      evidence.push({ ...frame, image: `storage:${path}` });
    }
    const additional = [...new Set(evidence.map((frame) => frame.image.slice("storage:".length)))]
      .reduce((sum, path) => sum + (extraRedactions.get(path) ?? 0), 0);
    versions.push({ ...version, evidence, privacy: version.privacy && additional ? {
      ...version.privacy, redactions: version.privacy.redactions + additional,
      status: "redaction applied",
    } : version.privacy });
  }
  const { versions: _versions, ...metadata } = record;
  const previous = await db.from("tacit_processes").select("current_version")
    .eq("workspace_id", WORKSPACE).eq("id", record.id).maybeSingle();
  if (previous.error) throw new Error("cloud_process_save_failed");
  const parent = {
    workspace_id: WORKSPACE, id: record.id, owner_id: record.ownerId,
    title: record.title, created_at: record.createdAt, updated_at: record.updatedAt,
    current_version: previous.data?.current_version ?? 0, payload: metadata,
  };
  const first = await db.from("tacit_processes").upsert(parent, { onConflict: "workspace_id,id" });
  if (first.error) throw new Error("cloud_process_save_failed");
  const rows = versions.map((version) => ({
    workspace_id: WORKSPACE, id: version.id, process_id: record.id,
    version_number: version.number, based_on_version_id: version.basedOnVersionId,
    status: version.status, created_at: version.createdAt, payload: version,
  }));
  const second = await db.from("tacit_process_versions").upsert(rows, { onConflict: "workspace_id,id" });
  if (second.error) throw new Error("cloud_version_save_failed");
  const final = await db.from("tacit_processes").update({ current_version: versions.length })
    .eq("workspace_id", WORKSPACE).eq("id", record.id);
  if (final.error) throw new Error("cloud_process_save_failed");
}

export async function listCloudProcesses(): Promise<RecordedProcess[]> {
  const db = client();
  const parents = await db.from("tacit_processes").select("id,payload,current_version")
    .eq("workspace_id", WORKSPACE).order("updated_at", { ascending: false }).limit(50);
  if (parents.error) throw new Error("cloud_load_failed");
  const result: RecordedProcess[] = [];
  for (const row of parents.data ?? []) {
    const children = await db.from("tacit_process_versions").select("payload")
      .eq("workspace_id", WORKSPACE).eq("process_id", row.id)
      .order("version_number", { ascending: true }).limit(20);
    if (children.error) throw new Error("cloud_load_failed");
    if (!row.current_version || children.data?.length !== row.current_version) continue;
    const versions: ProcessVersion[] = [];
    for (const child of children.data) {
      const version = child.payload as ProcessVersion;
      const evidence = [];
      for (const frame of version.evidence) {
        if (!frame.image.startsWith(`storage:${WORKSPACE}/${row.id}/`)) throw new Error("cloud_invalid_reference");
        const path = frame.image.slice("storage:".length);
        const { data, error } = await db.storage.from(BUCKET).download(path);
        if (error || !data) throw new Error("cloud_image_download_failed");
        const bytes = Buffer.from(await data.arrayBuffer());
        if (bytes.length > 2_000_000) throw new Error("cloud_invalid_image");
        evidence.push({ ...frame, image: `${imagePrefix}${bytes.toString("base64")}` });
      }
      versions.push({ ...version, evidence });
    }
    result.push({ ...(row.payload as Omit<RecordedProcess, "versions">), versions });
  }
  return result;
}

export async function deleteCloudProcess(id: string) {
  if (!idPattern.test(id)) throw new Error("cloud_invalid_id");
  const db = client();
  const children = await db.from("tacit_process_versions").select("payload")
    .eq("workspace_id", WORKSPACE).eq("process_id", id);
  if (children.error) throw new Error("cloud_delete_failed");
  const paths = new Set<string>();
  for (const child of children.data ?? []) for (const frame of (child.payload as ProcessVersion).evidence) {
    if (frame.image.startsWith(`storage:${WORKSPACE}/${id}/`)) paths.add(frame.image.slice("storage:".length));
  }
  const removed = await db.from("tacit_processes").delete().eq("workspace_id", WORKSPACE).eq("id", id);
  if (removed.error) throw new Error("cloud_delete_failed");
  if (paths.size) {
    const images = await db.storage.from(BUCKET).remove([...paths]);
    if (images.error) throw new Error("cloud_image_cleanup_failed");
  }
}
