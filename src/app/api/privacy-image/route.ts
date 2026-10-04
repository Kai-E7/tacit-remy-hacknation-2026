import "server-only";
import { createImagePrivacyHandler } from "../../../server/image-privacy";

export const runtime = "nodejs";
export const POST = createImagePrivacyHandler({
  endpoint: process.env.PRESIDIO_URL,
  token: process.env.PRESIDIO_TOKEN,
  origins: [
    "http://127.0.0.1:3000", "http://localhost:3000",
    "http://127.0.0.1:3100", "http://localhost:3100",
    ...(process.env.PUBLIC_BASE_URL ? [process.env.PUBLIC_BASE_URL.replace(/\/$/, "")] : []),
  ],
  authorized: () => true,
});
