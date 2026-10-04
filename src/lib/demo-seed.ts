import { buildDemoProcesses, DEMO_ENGLISH_MARKER, DEMO_PROCESS_SPECS, DEMO_SEED_MARKER, demoImagePath } from "./demo-processes";
import { addDemoProcesses, removeLegacyGermanSyntheticProcesses, updateUntouchedDemoProcesses } from "./process-store";

/** One-time, additive local examples; deletion is respected on later visits. */
export async function ensureDemoProcesses(): Promise<void> {
  // Run this narrow cleanup before the marker check as well. Older local tabs may
  // already have the English marker while still containing the original German
  // fixtures. Never touch captured processes; the remover only matches known demo IDs/content.
  await removeLegacyGermanSyntheticProcesses();
  if (localStorage.getItem(DEMO_ENGLISH_MARKER)) return;
  const alreadySeeded = !!localStorage.getItem(DEMO_SEED_MARKER);
  const images: Record<string, string> = {};
  for (const spec of DEMO_PROCESS_SPECS) for (const screen of spec.screens) {
    const response = await fetch(demoImagePath(screen));
    if (!response.ok) throw new Error("Synthetic example image unavailable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    images[screen.id] = `data:image/jpeg;base64,${btoa(binary)}`;
  }
  const examples = buildDemoProcesses(images);
  await updateUntouchedDemoProcesses(examples);
  if (!alreadySeeded) await addDemoProcesses(examples);
  localStorage.setItem(DEMO_SEED_MARKER, "done");
  localStorage.setItem(DEMO_ENGLISH_MARKER, "done");
}
