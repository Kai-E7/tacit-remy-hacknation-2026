import type { RecordedProcess } from "./processes";

/** Best-effort server backup after the local save has committed. Local data remains the source of truth. */
export async function syncProcessToCloud(process: RecordedProcess): Promise<boolean> {
  if (process.demo) return false;
  try {
    const response = await fetch("/api/cloud-processes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(process),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
