export const FRAME_INTERVAL_MS = 1000;
export const MAX_EVIDENCE_FRAMES = 12;

/** Preserve aspect ratio without upscaling. Provider limits belong in the adapter. */
export function fitFrame(width: number, height: number, maxWidth = 1280) {
  if (![width, height, maxWidth].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error("Invalid frame dimensions");
  }
  const scale = Math.min(1, maxWidth / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Invalidates late permission results/frames when a capture is stopped. */
export class CaptureGeneration {
  private generation = 0;
  begin() {
    return ++this.generation;
  }
  invalidate() {
    this.generation++;
  }
  isCurrent(token: number) {
    return token === this.generation;
  }
}

export function captureErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError")
    return "Screen permission was cancelled or denied. Try again and select only the practice tab.";
  if (name === "NotReadableError")
    return "The screen is not readable. Check your browser's screen-recording permission in system settings.";
  if (name === "InvalidStateError")
    return "Start screen sharing from the button in an active browser window.";
  return "Screen sharing is unavailable. Use a current desktop browser on localhost or HTTPS.";
}
