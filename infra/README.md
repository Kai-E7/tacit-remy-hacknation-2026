# Infrastructure

## Sliplane setup

The reference deployment runs on Sliplane. A new deployment needs its own
provider credentials and a manual microphone/screen-permission check.

1. Connect this repository in Sliplane.
2. Select the `main` branch and repository-root build context / `Dockerfile`.
3. Run as an HTTP service on container port `3000`; health endpoint `/api/health`.
4. Use Sliplane's HTTPS URL. Screen capture requires HTTPS or localhost and an
   explicit user click; native browser/OS permission cannot be bypassed.
5. Voice uses the server-side ElevenLabs key and two agent IDs. Production voice
   defaults off. Set `VOICE_ENABLED=true`, `LEARNING_ENABLED=true` and the exact
   HTTPS `PUBLIC_BASE_URL` after checking the public-demo rate limits. The old
   `DEMO_GATE_ENABLED`, `DEMO_PASSWORD` and `SESSION_SIGNING_SECRET` settings
   are ignored and can be removed from Sliplane.
6. Run the Presidio service on private networking using
   `infra/presidio/Dockerfile` as a separate build context from repository root.
   Give it a random `PRESIDIO_TOKEN` of at least 32 characters. In the Next app,
   set `PRESIDIO_URL=http://presidio:5003` (or the actual private service DNS name)
   and the same token. The app image includes English Tesseract OCR; network and
   image latency still need a deployment test. Never expose the Python service
   publicly.
7. Verify the deployed page, sandbox and health endpoint from a fresh browser.
   Test real microphone/screen permissions manually after voice integration.
8. For optional **local-development-only** synthetic-demo cloud backup, set `SUPABASE_URL` to the exact
   project HTTPS URL and `SUPABASE_SECRET_KEY` to a server-only `sb_secret_` key.
   Do **not** put the key in `NEXT_PUBLIC_*` or browser settings. The legacy
   `SUPABASE_SERVICE_ROLE_KEY` is unnecessary when the new secret key is set.
   Backup also requires the private Presidio service in step 6: missing/failed
   text or image checks block upload. The public deployment denies cloud reads,
   writes and deletes until real user-level authorization exists.

Docker uses a Next.js standalone build and a non-root runtime. `.env*`, local
dependencies and Git history are excluded from the image build context. No
provider secrets belong in Docker build arguments. The root `package-lock.json`
pins dependencies; `npm ci` is used in the image. No Docker daemon was available
during the initial local checks, so container execution remains a deployment test.

The screen/vision path needs both containers; a healthy `/api/health` alone does
not prove it works. Selected frames are OCR-scanned and masked before Claude or
new local storage. OCR misses are possible. Without the private service, images
are withheld and the text fallback stays a local draft.

```sh
docker build -t ai-apprentice .
docker run --rm -p 3000:3000 ai-apprentice
```

Build the separate private service from the repository root with
`docker build -f infra/presidio/Dockerfile -t tacit-presidio .`. No container build
has been verified on this machine yet.

## Storage

The Supabase project in eu-west-1 has RLS-enabled process/version tables and a
private evidence bucket. A server-only manual backup/restore path has passed a
synthetic local round-trip, but is disabled for the public demo. Passwordless
visitors have no per-user cloud authorization; real customer
records require user isolation, retention controls and a separate security review.
No persistent volume is needed for the proposed stateless app container.
Do not write durable data into the container filesystem.

Sliplane API keys are only needed for deployment automation, not application
runtime. Existing credits do not imply unlimited resources or cover other vendors.
No paid resource should be created without checking its displayed price/credit use.

Sources: [Sliplane deployment](https://docs.sliplane.io/introduction/getting-started/),
[Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output),
[Supabase pricing](https://supabase.com/pricing).
