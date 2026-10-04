export type ImagePrivacyResult = {
  image: string;
  redactions: number;
  status: "privacy scan passed" | "redaction applied";
};

/** Raw pixels exist only in this request and memory; only returned pixels may persist. */
export async function privacyImageScan(image: string, signal?: AbortSignal): Promise<ImagePrivacyResult> {
  const response = await fetch("/api/privacy-image", {
    method: "POST", headers: { "Content-Type": "application/json" },
    cache: "no-store", body: JSON.stringify({ image }),
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]),
  });
  if (!response.ok) throw new Error("Image privacy check failed; this image remains blocked.");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("image" in result) ||
    typeof result.image !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(result.image) ||
    !("redactions" in result) || !Number.isInteger(result.redactions) ||
    !("status" in result) || !["privacy scan passed", "redaction applied"].includes(String(result.status)))
    throw new Error("Invalid image privacy check response.");
  return result as ImagePrivacyResult;
}
