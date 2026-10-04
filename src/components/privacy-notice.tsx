import type { PrivacyReport } from "../lib/privacy";
export function PrivacyNotice({ report }: { report?: PrivacyReport | null }) {
  return (
    <p className="caption" data-testid="privacy-status">
      <strong>{report?.status ?? "Privacy scan on save"}</strong>
      {report
        ? ` · ${report.engine === "presidio" ? "Presidio text and image OCR" : "Demo text filter · Presidio unavailable"} · ${report.redactions} redactions.`
        : " · Selected images and transcript are checked before AI processing and storage."}
      {report?.imagesWithheld
        ? ` ${report.imagesWithheld} images withheld.`
        : ""}{" "}
      Avoid personal or confidential information in this demo. Checked images are stored locally; failed images are withheld.
      PII detection is not complete. Live audio goes to ElevenLabs without this filter.
    </p>
  );
}
