import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEMO_PROCESS_SPECS } from "../src/lib/demo-processes.ts";

const output = new URL("../public/demo-evidence/", import.meta.url);
await mkdir(output, { recursive: true });
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
for (const spec of DEMO_PROCESS_SPECS) {
  for (const screen of spec.screens) {
    const accent = screen.app === "Outlook" ? "#1967a5" : screen.app === "Notion" ? "#272e2a" : "#345a48";
    const rows = screen.fields.map(([label, value], index) => `<g transform="translate(345 ${248 + index * 92})"><text x="0" y="0" fill="#667269" font-size="21">${escape(label)}</text><rect x="0" y="16" width="680" height="55" rx="9" fill="#fafaf5" stroke="#dfe4da"/><text x="20" y="52" fill="#193c32" font-size="25" font-weight="600">${escape(value)}</text></g>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720"><rect width="1200" height="720" fill="#f1f3ed"/><rect x="36" y="35" width="1128" height="650" rx="18" fill="#fffefb" stroke="#dce2d8"/><rect x="36" y="35" width="1128" height="80" rx="18" fill="${accent}"/><rect x="36" y="95" width="1128" height="20" fill="${accent}"/><text x="73" y="87" fill="white" font-family="Arial" font-size="29" font-weight="700">${escape(screen.app)}</text><text x="870" y="84" fill="#ebf5ed" font-family="Arial" font-size="17">SYNTHETIC DEMO</text><rect x="36" y="115" width="260" height="570" fill="#e9eee6"/><text x="71" y="174" fill="#40584b" font-family="Arial" font-size="20" font-weight="700">${escape(screen.area)}</text><text x="71" y="231" fill="#6f7c71" font-family="Arial" font-size="18">Overview</text><text x="71" y="281" fill="#6f7c71" font-family="Arial" font-size="18">Records</text><text x="71" y="331" fill="#6f7c71" font-family="Arial" font-size="18">Activity</text><text x="345" y="177" fill="#18372e" font-family="Arial" font-size="35" font-weight="700">${escape(screen.title)}</text><text x="345" y="212" fill="#647369" font-family="Arial" font-size="17">${escape(screen.status)}</text><g font-family="Arial">${rows}</g><rect x="345" y="625" width="680" height="39" rx="7" fill="#e5eee1"/><text x="361" y="651" fill="#244733" font-family="Arial" font-size="18">${escape(screen.highlight)}</text><text x="72" y="651" fill="#476253" font-family="Arial" font-size="16" font-weight="700">NOT REAL DATA</text></svg>`;
    await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toFile(fileURLToPath(new URL(`${screen.id}.jpg`, output)));
  }
}
console.log("Built 12 synthetic demo screenshots.");
