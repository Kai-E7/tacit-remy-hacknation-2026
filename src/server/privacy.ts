import {
  fallbackRedact,
  validPrivacyResult,
  type PrivacyResult,
} from "../lib/privacy.ts";

/** Pure server adapter; only the server-only route/runtime may configure its endpoint. */
export function createPrivacyScanner(config: {
  endpoint?: string;
  token?: string;
  request?: typeof fetch;
}) {
  let endpoint: URL | undefined;
  try {
    if (config.endpoint) {
      const u = new URL(config.endpoint);
      if (
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        (u.protocol !== "https:" &&
          !(
            u.protocol === "http:" &&
            ["127.0.0.1", "localhost", "presidio"].includes(u.hostname)
          ))
      )
        throw new Error();
      endpoint = u;
    }
  } catch {
    /* Invalid configuration fails closed to explicit fallback. */
  }
  return async (
    texts: string[],
    signal?: AbortSignal,
  ): Promise<PrivacyResult> => {
    if (!endpoint) return fallbackRedact(texts);
    try {
      const r = await (config.request ?? fetch)(new URL("/redact", endpoint), {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.any([
          ...(signal ? [signal] : []),
          AbortSignal.timeout(15000),
        ]),
      });
      if (!r.ok) throw new Error("unavailable");
      const result: unknown = await r.json();
      if (
        !validPrivacyResult(result, texts.length) ||
        result.report.engine !== "presidio"
      )
        throw new Error("invalid");
      return result;
    } catch {
      signal?.throwIfAborted();
      return fallbackRedact(texts);
    }
  };
}

export function createPrivacyHandler(config: {
  authorized(req: Request): boolean;
  origins: string[];
  scan(texts: string[], signal?: AbortSignal): Promise<PrivacyResult>;
}) {
  let busy = false,
    count = 0,
    since = Date.now();
  const reply = (body: object, status = 200) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  return async (req: Request) => {
    if (!config.authorized(req))
      return reply({ error: "access_required" }, 401);
    if (req.method !== "POST") return reply({ error: "invalid_method" }, 405);
    if (
      !config.origins.includes(req.headers.get("origin") ?? "") ||
      req.headers.get("sec-fetch-site") === "cross-site"
    )
      return reply({ error: "origin_not_allowed" }, 403);
    if (!req.headers.get("content-type")?.startsWith("application/json"))
      return reply({ error: "invalid_request" }, 415);
    if (Date.now() - since > 3600000) {
      count = 0;
      since = Date.now();
    }
    if (busy || count >= 600) return reply({ error: "privacy_busy" }, 429);
    busy = true;
    count++;
    try {
      const reader = req.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1000000) {
          await reader.cancel();
          return reply({ error: "too_large" }, 413);
        }
        chunks.push(value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !Array.isArray(body.texts) ||
        body.texts.length > 250 ||
        body.texts.some(
          (s: unknown) => typeof s !== "string" || s.length > 6000,
        )
      )
        throw new Error();
      return reply(await config.scan(body.texts, req.signal));
    } catch {
      return reply({ error: "privacy_invalid_or_unavailable" }, 400);
    } finally {
      busy = false;
    }
  };
}
