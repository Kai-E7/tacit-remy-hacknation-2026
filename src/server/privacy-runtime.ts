import "server-only";
import { createPrivacyScanner } from "./privacy";
export const scanPrivateText = createPrivacyScanner({
  endpoint: process.env.PRESIDIO_URL,
  token: process.env.PRESIDIO_TOKEN,
});
