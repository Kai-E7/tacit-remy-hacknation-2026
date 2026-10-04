// Manual integration smoke: real Tesseract, private Presidio, and pixel masking.
// Uses only generated synthetic content. Run with PRESIDIO_URL=http://127.0.0.1:5004.
import assert from "node:assert/strict";
import sharp from "sharp";
import { spawnSync } from "node:child_process";
import { redactImage } from "../src/server/image-privacy.ts";

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="480"><rect width="1280" height="480" fill="white"/><text x="40" y="90" font-family="Arial" font-size="40" fill="black">Jane Doe</text><text x="40" y="170" font-family="Arial" font-size="40" fill="black">jane.doe@example.com</text><text x="40" y="250" font-family="Arial" font-size="40" fill="black">Outlook</text><text x="40" y="330" font-family="Arial" font-size="40" fill="black">DE89370400440532013000</text></svg>');
const input = await sharp(svg).jpeg({ quality: 90 }).toBuffer();
const result = await redactImage(input, { endpoint: process.env.PRESIDIO_URL });
assert.ok(result.redactions >= 3, `expected at least three masked words, got ${result.redactions}`);
const ocr = spawnSync("tesseract", ["stdin", "stdout", "-l", "eng", "--psm", "11"], { input: result.image, encoding: "utf8" });
assert.equal(ocr.status, 0);
assert.doesNotMatch(ocr.stdout, /Jane|jane\.doe|DE893704/i);
assert.match(ocr.stdout, /Outlook/i);
console.log("image privacy integration passed: synthetic name, email, IBAN hidden; Outlook retained");
