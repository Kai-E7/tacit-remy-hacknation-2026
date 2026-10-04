import { privacyScan, type PrivacyResult } from "./privacy.ts";
import { privacyImageScan, type ImagePrivacyResult } from "./privacy-image.ts";
import type { RecordingInput } from "./processes.ts";

/** Only this new, filtered object may be saved; no raw recovery copy. */
export async function preparePrivateRecording(
  input: RecordingInput,
  scan: (texts: string[]) => Promise<PrivacyResult> = privacyScan,
  scanImage: (image: string) => Promise<ImagePrivacyResult> = privacyImageScan,
): Promise<RecordingInput> {
  const transcript = input.transcript ?? [];
  const result = await scan([
    input.title,
    input.summary,
    ...transcript.map((u) => u.text),
  ]);
  const evidence = [];
  let imagesWithheld = input.privacy?.imagesWithheld ?? 0;
  let imageRedactions = 0;
  // Sequential requests respect the private scanner's resource limit.
  for (const frame of input.evidence) {
    try {
      const reviewed = await scanImage(frame.image);
      evidence.push({ ...frame, image: reviewed.image, note: "" });
      imageRedactions += reviewed.redactions;
    } catch {
      imagesWithheld++;
    }
  }
  return {
    ...input,
    title: result.texts[0],
    summary: result.texts[1],
    transcript: transcript.map((u, i) => ({ ...u, text: result.texts[i + 2] })),
    evidence,
    workMap: undefined,
    reviewedAt: undefined,
    privacy: {
      ...result.report,
      redactions: result.report.redactions + imageRedactions,
      imagesWithheld,
      status:
        imagesWithheld || result.report.engine !== "presidio"
          ? "manual review required"
          : imageRedactions || result.report.redactions
            ? "redaction applied"
            : "privacy scan passed",
    },
  };
}
