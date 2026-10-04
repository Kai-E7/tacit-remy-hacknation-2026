import "server-only";
import { createVoiceTokenHandler } from "../../../server/voice-token";

export const runtime = "nodejs";

const local = process.env.NODE_ENV === "development";
const origins = local
  ? [
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://127.0.0.1:3100",
      "http://localhost:3100",
    ]
  : [];
try {
  const url = new URL(process.env.PUBLIC_BASE_URL ?? "");
  if (url.protocol === "https:") origins.push(url.origin);
} catch {
  /* Missing production origin keeps the route closed. */
}

export const POST = createVoiceTokenHandler({
  enabled:
    process.env.VOICE_ENABLED === "true" ||
    (local && process.env.VOICE_ENABLED !== "false"),
  origins,
  apiKey: process.env.ELEVENLABS_API_KEY,
  agents: {
    interviewer: process.env.ELEVENLABS_INTERVIEWER_AGENT_ID,
    tutor: process.env.ELEVENLABS_TUTOR_AGENT_ID,
  },
});
