# Tacit — Remy

Remy is an AI apprentice for capturing how experienced people work: show a screen or describe a process, explain decisions and exceptions, then review a source-linked process map. This is a Hack-Nation AI Apprentice prototype.

**Live demo:** https://tacit-remy.sliplane.app

## What the demo includes

- Screen-guided and voice-only workflow interviews
- An interactive left-to-right process flow with responsibility lanes and linked evidence
- A browser-local process library with versions, expert review, guidance and PDF export
- Three clearly marked fictional example processes with 12 generated mock screenshots

The examples are created from [fictional fixtures](src/lib/demo-processes.ts) by [the screenshot generator](scripts/build-demo-screenshots.mjs). They do not contain customer records.

## Architecture

Next.js, React and TypeScript provide the web app. The browser requests screen/microphone permission only when the user starts sharing. ElevenLabs handles voice; Claude structures selected evidence into a Work Map. The privacy gate uses Microsoft Presidio for text and OCR-span checks, Tesseract for OCR and Sharp for image masking. React Flow and Dagre render the process diagram. IndexedDB stores versions in the visitor's browser. Jev via OpenRouter is optional for interruption timing; deterministic rules remain authoritative.

The public demo has no account-level authentication. Its Supabase cloud-process endpoint is disabled in production; no visitor should assume shared or durable cloud storage. Live audio goes to ElevenLabs without passing through the Presidio gate. Automated PII detection is incomplete: share only data you have permission to show, and review generated maps and screenshots before relying on them.

## Run locally

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Populate only the server-side keys needed for the features you test. Never commit `.env.local`. See [the example configuration](.env.example) and [the Presidio service](infra/presidio/).

## Verify

```sh
npm test
npm run typecheck
npm run build
```

Browser tests use Playwright: `npm run test:e2e`. Real microphone and screen-permission behavior still needs manual verification in the target browser.

## License

MIT. See [LICENSE](LICENSE).
