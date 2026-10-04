/** Use only browser-supplied metadata; never guess which physical monitor was selected. */
export function describeSharingSource(track: {
  label: string;
  getSettings(): { displaySurface?: string; width?: number; height?: number };
}) {
  const settings = track.getSettings();
  const kind =
    (
      { browser: "Tab", window: "Window", monitor: "Screen" } as Record<
        string,
        string
      >
    )[settings.displaySurface ?? ""] ?? "Share";
  const label = track.label.trim().slice(0, 160);
  const size =
    settings.width && settings.height
      ? `${settings.width} × ${settings.height}`
      : "";
  return [label ? `${kind}: ${label}` : kind, size].filter(Boolean).join(" · ");
}

export function formatCaptureTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
