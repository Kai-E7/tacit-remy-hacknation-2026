import "server-only";
import { createPrivacyHandler } from "../../../server/privacy";
import { scanPrivateText } from "../../../server/privacy-runtime";
export const runtime = "nodejs";
export const POST = createPrivacyHandler({
  origins: [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3100",
    "http://localhost:3100",
    ...(process.env.PUBLIC_BASE_URL
      ? [process.env.PUBLIC_BASE_URL.replace(/\/$/, "")]
      : []),
  ],
  authorized: () => true,
  scan: scanPrivateText,
});
