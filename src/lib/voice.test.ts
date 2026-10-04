import { test } from "node:test";
import assert from "node:assert/strict";
import { createVoiceTokenHandler } from "../server/voice-token.ts";
import {
  createVoiceSession,
  type VoiceConnector,
  type VoiceState,
} from "./voice-session.ts";

const origin = "http://localhost:3000";
const config = {
  enabled: true,
  origins: [origin],
  apiKey: "server-secret",
  agents: { interviewer: "private-interviewer", tutor: "private-tutor" },
};
function req(body: unknown = { role: "interviewer" }, from = origin) {
  return new Request(`${origin}/api/voice-token`, {
    method: "POST",
    headers: { origin: from, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
test("token route accepts only same-origin named roles; never calls upstream on invalid input", async () => {
  let calls = 0;
  const handler = createVoiceTokenHandler({
    ...config,
    request: async () => {
      calls++;
      return Response.json({ token: "ticket" });
    },
  });
  assert.equal((await handler(req({}, "https://evil.example"))).status, 403);
  for (const bad of [
    { role: "admin" },
    { role: "interviewer", agentId: "arbitrary" },
    null,
    [],
    { role: "toString" },
  ]) {
    assert.equal((await handler(req(bad))).status, 400);
  }
  assert.equal((await handler(req({ role: "x".repeat(300) }))).status, 413);
  assert.equal(calls, 0);
});
test("role selects only server agent; response contains only uncached ticket", async () => {
  for (const role of ["interviewer", "tutor"] as const) {
    const handler = createVoiceTokenHandler({
      ...config,
      request: async (url, init) => {
        assert.equal(new URL(String(url)).origin, "https://api.elevenlabs.io");
        assert.equal(
          new URL(String(url)).searchParams.get("agent_id"),
          config.agents[role],
        );
        assert.equal(
          new URL(String(url)).searchParams.get("participant_name"),
          "Demo-User",
        );
        assert.equal(
          new Headers(init?.headers).get("xi-api-key"),
          "server-secret",
        );
        assert.equal(init?.redirect, "error");
        return Response.json({
          token: "short-lived-ticket",
          conversation_id: "not-returned",
          secret: "not-returned",
        });
      },
    });
    const response = await handler(req({ role }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { token: "short-lived-ticket" });
  }
});
test("disabled/missing configuration and provider failures expose sanitized errors", async () => {
  const noCall: typeof fetch = async () => {
    throw new Error("must not call");
  };
  assert.equal(
    (
      await createVoiceTokenHandler({
        ...config,
        enabled: false,
        request: noCall,
      })(req())
    ).status,
    503,
  );
  assert.equal(
    (
      await createVoiceTokenHandler({ ...config, apiKey: "", request: noCall })(
        req(),
      )
    ).status,
    503,
  );
  const handler = createVoiceTokenHandler({
    ...config,
    request: async () =>
      new Response("secret provider details", { status: 401 }),
  });
  assert.deepEqual(await (await handler(req())).json(), {
    error: "voice_permission_missing",
  });
  assert.equal(
    (
      await createVoiceTokenHandler({
        ...config,
        request: async () => Response.json({ token: 7 }),
      })(req())
    ).status,
    502,
  );
});
test("token issuance is throttled and globally bounded per server process", async () => {
  let time = 0;
  let calls = 0;
  const handler = createVoiceTokenHandler({
    ...config,
    now: () => time,
    request: async () => {
      calls++;
      return Response.json({ token: "ticket" });
    },
  });
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 429);
  for (let i = 1; i < 20; i++) {
    time += 3000;
    assert.equal((await handler(req())).status, 200);
  }
  time += 3000;
  assert.equal((await handler(req())).status, 429);
  assert.equal(calls, 20);
  time = 3_600_000;
  assert.equal((await handler(req())).status, 200);
});

function harness(connect: VoiceConnector, request?: typeof fetch) {
  const states: VoiceState[] = [];
  const errors: string[] = [];
  const messages: string[] = [];
  return {
    states,
    errors,
    messages,
    controller: createVoiceSession({
      connect,
      request: request ?? (async () => Response.json({ token: "ticket" })),
      onState: (s) => states.push(s),
      onError: (s) => errors.push(s),
      onMessage: (m) => messages.push(m.message),
    }),
  };
}
test("screen context and user-requested debrief reach only the active connection", async () => {
  const contexts: string[] = [],
    commands: string[] = [];
  const h = harness(async () => ({
    endSession: async () => {},
    setMicMuted() {},
    setVolume() {},
    sendContextualUpdate: (s) => contexts.push(s),
    sendUserMessage: (s) => commands.push(s),
  }));
  assert.equal(h.controller.sendContext("before"), false);
  await h.controller.start("interviewer");
  assert.equal(h.controller.sendContext("actual screen observation"), true);
  assert.equal(h.controller.sendMessage("debrief requested"), true);
  await h.controller.stop();
  assert.equal(h.controller.sendContext("off-record"), false);
  assert.equal(h.controller.sendMessage("off-record"), false);
  assert.deepEqual(contexts, ["actual screen observation"]);
  assert.deepEqual(commands, ["debrief requested"]);
});
test("voice stop closes a connected session once and ignores late transcript", async () => {
  let ends = 0;
  let onMessage!: Parameters<VoiceConnector>[0]["onMessage"];
  const muted: boolean[] = [];
  const h = harness(async (o) => {
    onMessage = o.onMessage;
    assert.equal(o.token, "ticket");
    return {
      endSession: async () => {
        ends++;
      },
      setMicMuted: (v) => muted.push(v),
      setVolume() {},
    };
  });
  await h.controller.start("interviewer");
  assert.equal(h.states.at(-1), "connected");
  await Promise.all([h.controller.stop(), h.controller.stop()]);
  onMessage({ role: "user", message: "must not record", eventId: 1 });
  assert.equal(h.states.at(-1), "idle");
  assert.equal(ends, 1);
  assert.deepEqual(muted, [true]);
  assert.deepEqual(h.messages, []);
});
test("stop during token request prevents SDK start even if fetch returns late", async () => {
  let resolve!: (r: Response) => void;
  let connects = 0;
  const h = harness(
    async () => {
      connects++;
      throw new Error("must not connect");
    },
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const start = h.controller.start("tutor");
  const stop = h.controller.stop();
  resolve(Response.json({ token: "late-ticket" }));
  await Promise.all([start, stop]);
  assert.equal(connects, 0);
  assert.equal(h.states.at(-1), "idle");
});
test("pending SDK connection is closed on late resolution; restart remains locked", async () => {
  let resolve!: (c: Awaited<ReturnType<VoiceConnector>>) => void;
  let entered!: () => void;
  const entering = new Promise<void>((r) => {
    entered = r;
  });
  let connects = 0,
    ends = 0;
  const h = harness(() => {
    connects++;
    entered();
    return new Promise((r) => {
      resolve = r;
    });
  });
  const start = h.controller.start("interviewer");
  await entering;
  const stop = h.controller.stop();
  await h.controller.start("tutor");
  assert.equal(h.states.at(-1), "stopping");
  resolve({
    endSession: async () => {
      ends++;
    },
    setMicMuted() {},
    setVolume() {},
  });
  await Promise.all([start, stop]);
  assert.equal(connects, 1);
  assert.equal(ends, 1);
  assert.equal(h.states.at(-1), "idle");
});
test("microphone refusal is actionable and provider details never enter UI", async () => {
  const h = harness(async () => {
    throw new DOMException("raw private error", "NotAllowedError");
  });
  await h.controller.start("interviewer");
  assert.equal(h.states.at(-1), "error");
  assert.match(h.errors.at(-1)!, /Microphone access was denied/);
  assert.ok(!h.errors.join().includes("raw private"));
});

test("failed late cleanup stays blocking and does not falsely report idle", async () => {
  let resolve!: (c: Awaited<ReturnType<VoiceConnector>>) => void;
  let entered!: () => void;
  const entering = new Promise<void>((r) => {
    entered = r;
  });
  let connects = 0;
  const h = harness(() => {
    connects++;
    entered();
    return new Promise((r) => {
      resolve = r;
    });
  });
  const starting = h.controller.start("interviewer");
  await entering;
  const stopping = h.controller.stop();
  const rejected = assert.rejects(stopping, /cleanup failed/);
  resolve({
    endSession: async () => {
      throw new Error("private cleanup failure");
    },
    setMicMuted() {},
    setVolume() {},
  });
  await starting;
  await rejected;
  assert.equal(h.states.at(-1), "stopping");
  await h.controller.start("tutor");
  assert.equal(connects, 1);
});

test("transport disconnection is visible as an error", async () => {
  let disconnect!: Parameters<VoiceConnector>[0]["onDisconnect"];
  const h = harness(async (o) => {
    disconnect = o.onDisconnect;
    return { endSession: async () => {}, setMicMuted() {}, setVolume() {} };
  });
  await h.controller.start("interviewer");
  disconnect(true);
  assert.equal(h.states.at(-1), "error");
  assert.match(h.errors.at(-1)!, /interrupted/);
});
