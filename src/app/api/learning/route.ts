import "server-only";
import { createLearningHandler } from "../../../server/learning";
import { scanPrivateText } from "../../../server/privacy-runtime";
import { redactImage } from "../../../server/image-privacy";

export const runtime = "nodejs";
const local = process.env.NODE_ENV === "development";
export const POST = createLearningHandler({
  privacyScan: scanPrivateText,
  imageScan: async (image, signal) => {
    const source = Buffer.from(image.slice("data:image/jpeg;base64,".length), "base64");
    const result = await redactImage(source, {
      endpoint: process.env.PRESIDIO_URL,
      token: process.env.PRESIDIO_TOKEN,
      signal,
    });
    return `data:image/jpeg;base64,${result.image.toString("base64")}`;
  },
  enabled: local
    ? process.env.LEARNING_ENABLED !== "false"
    : process.env.LEARNING_ENABLED === "true",
  origins: [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3100",
    "http://localhost:3100",
    ...(process.env.PUBLIC_BASE_URL ? [process.env.PUBLIC_BASE_URL.replace(/\/$/, "")] : []),
  ],
  apiKey: process.env.ANTHROPIC_API_KEY,
  visionModel: process.env.ANTHROPIC_VISION_MODEL,
  mapModel: process.env.ANTHROPIC_MAP_MODEL,
  liveModel: process.env.ANTHROPIC_LIVE_MAP_MODEL || "claude-sonnet-5-5",
});
