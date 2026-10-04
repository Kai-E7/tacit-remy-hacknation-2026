/** Pure handler factory; credentials are supplied only by the server-only route. */
export function createVoiceTokenHandler(options: {
  enabled: boolean;
  origins: string[];
  apiKey?: string;
  agents: { interviewer?: string; tutor?: string };
  request?: typeof fetch;
  now?: () => number;
}) {
  const request = options.request ?? fetch;
  const now = options.now ?? Date.now;
  let windowStart = now();
  let count = 0;
  let lastStart = -Infinity;
  const reply = (body: object, status: number) =>
    Response.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  return async (req: Request) => {
    if (req.method !== "POST")
      return reply({ error: "method_not_allowed" }, 405);
    if (!options.enabled) return reply({ error: "voice_disabled" }, 503);
    const origin = req.headers.get("origin");
    if (
      !origin ||
      !options.origins.includes(origin) ||
      req.headers.get("sec-fetch-site") === "cross-site"
    )
      return reply({ error: "origin_not_allowed" }, 403);
    if (
      req.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    )
      return reply({ error: "invalid_request" }, 415);
    let input: unknown;
    try {
      const reader = req.body?.getReader();
      if (!reader) return reply({ error: "invalid_request" }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256) {
          await reader.cancel();
          return reply({ error: "request_too_large" }, 413);
        }
        chunks.push(value);
      }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return reply({ error: "invalid_request" }, 400);
    }
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !("role" in input) ||
      (input.role !== "interviewer" && input.role !== "tutor")
    )
      return reply({ error: "invalid_role" }, 400);
    const agent = options.agents[input.role]?.trim();
    if (!agent || !options.apiKey?.trim())
      return reply({ error: "voice_not_configured" }, 503);
    if (req.signal.aborted) return reply({ error: "cancelled" }, 408);
    // Single-container demo budget, not user authentication or a distributed quota.
    if (now() - windowStart >= 3_600_000) {
      windowStart = now();
      count = 0;
    }
    if (count >= 20 || now() - lastStart < 3000)
      return reply({ error: "voice_rate_limited" }, 429);
    count++;
    lastStart = now();
    const url = new URL(
      "https://api.elevenlabs.io/v1/convai/conversation/token",
    );
    url.searchParams.set("agent_id", agent);
    url.searchParams.set("participant_name", "Demo-User");
    const timeout = AbortSignal.timeout(8000);
    try {
      const response = await request(url, {
        headers: { "xi-api-key": options.apiKey.trim() },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([req.signal, timeout]),
      });
      if (!response.ok)
        return reply(
          {
            error:
              response.status === 401 || response.status === 403
                ? "voice_permission_missing"
                : response.status === 429
                  ? "voice_provider_busy"
                  : "voice_provider_unavailable",
          },
          502,
        );
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        !("token" in body) ||
        typeof body.token !== "string" ||
        !body.token ||
        body.token.length > 16000
      )
        return reply({ error: "voice_invalid_response" }, 502);
      // Never return the API key, agent config, raw errors or conversation metadata.
      return reply({ token: body.token }, 200);
    } catch {
      return reply(
        {
          error: timeout.aborted
            ? "voice_timeout"
            : "voice_provider_unavailable",
        },
        502,
      );
    }
  };
}
