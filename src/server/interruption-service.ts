import "server-only";
import { createTimingDecider } from "../lib/interruptions/decider";
import { createJevProvider } from "./jev-client";

/** Call once per authenticated session when voice is wired; no public endpoint yet. */
export function createSessionTimingDecider() {
  const mode =
    process.env.INTERRUPTION_DECISION_PROVIDER === "jev" ? "jev" : "rules";
  // OPENROUTER_API_KEY is canonical; TYPESAFE_API_KEY is retained for the
  // existing local setup so the user does not need to paste the secret again.
  const key =
    process.env.OPENROUTER_API_KEY?.trim() || process.env.TYPESAFE_API_KEY?.trim();
  return createTimingDecider({
    mode,
    provider:
      mode === "jev" && key
        ? createJevProvider(key, process.env.JEV_MODEL?.trim() || "jev-latest")
        : undefined,
  });
}
