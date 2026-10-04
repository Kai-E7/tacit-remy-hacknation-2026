export type VoiceRole = "interviewer" | "tutor";
export type VoiceState =
  "idle" | "starting" | "connected" | "stopping" | "error";
export type VoiceMessage = {
  role: "user" | "agent";
  message: string;
  eventId: number;
};
export type VoiceConnection = {
  endSession(): Promise<void>;
  setMicMuted(muted: boolean): void;
  setVolume(value: { volume: number }): void;
  sendContextualUpdate?(text: string): void;
  sendUserMessage?(text: string): void;
};
export type VoiceConnector = (options: {
  token: string;
  signal: AbortSignal;
  onMessage(message: VoiceMessage): void;
  onDisconnect(failed?: boolean): void;
  onError(): void;
}) => Promise<VoiceConnection>;

export const voiceErrors: Record<string, string> = {
  voice_disabled:
    "Voice conversations are not enabled on this server yet.",
  voice_not_configured: "The voice agent has not been configured yet.",
  voice_permission_missing:
    "ElevenLabs access is missing. Please check the API key's agent permission.",
  voice_rate_limited:
    "Start limit reached. Please wait a moment and try again.",
  voice_provider_busy:
    "ElevenLabs is busy right now. Please try again later.",
  voice_timeout: "ElevenLabs did not respond. Please try again.",
};

/** Own one lifecycle per mounted workspace. Late permission/connection results cannot restart it. */
export function createVoiceSession(options: {
  connect: VoiceConnector;
  request?: typeof fetch;
  onState(state: VoiceState): void;
  onError(message: string): void;
  onMessage(message: VoiceMessage): void;
}) {
  let active:
    | {
        cancelled: boolean;
        abort: AbortController;
        connection?: VoiceConnection;
        done: Promise<void>;
        stopping?: Promise<void>;
        cleanupFailed?: boolean;
      }
    | undefined;
  const request = options.request ?? fetch;
  async function close(connection: VoiceConnection) {
    try {
      connection.setMicMuted(true);
    } catch {
      /* Still attempt teardown. */
    }
    try {
      connection.setVolume({ volume: 0 });
    } catch {
      /* Still attempt teardown. */
    }
    await connection.endSession();
  }
  async function stop() {
    const run = active;
    if (!run) return;
    if (run.stopping) return run.stopping;
    run.cancelled = true;
    run.abort.abort();
    options.onState("stopping");
    run.stopping = (async () => {
      if (run.connection) {
        await close(run.connection);
      }
      // SDK does not expose AbortSignal for its WebRTC handshake. Await cleanup;
      // never claim stopped or allow a restart while the old handshake is pending.
      await run.done;
      if (run.cleanupFailed) throw new Error("Voice cleanup failed");
      if (active === run) {
        active = undefined;
        options.onState("idle");
      }
    })();
    return run.stopping;
  }
  async function start(role: VoiceRole) {
    if (active) return;
    const run = {
      cancelled: false,
      abort: new AbortController(),
      done: Promise.resolve(),
      connection: undefined as VoiceConnection | undefined,
      cleanupFailed: false,
    };
    active = run;
    options.onError("");
    options.onState("starting");
    run.done = (async () => {
      try {
        const response = await request("/api/voice-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
          cache: "no-store",
          credentials: "same-origin",
          signal: AbortSignal.any([
            run.abort.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        const body = await response.json();
        if (run.cancelled) return;
        if (!response.ok || typeof body.token !== "string" || !body.token)
          throw new Error(
            voiceErrors[body.error] ??
              "Could not start the conversation. Please try again.",
          );
        let disconnected = false;
        const connection = await options.connect({
          token: body.token,
          signal: run.abort.signal,
          onMessage: (message) => {
            if (!run.cancelled && active === run) options.onMessage(message);
          },
          onDisconnect: (failed) => {
            disconnected = true;
            if (active === run && !run.cancelled) {
              active = undefined;
              if (failed)
                options.onError(
                  "The voice connection was interrupted. Please reconnect.",
                );
              options.onState(failed ? "error" : "idle");
            }
          },
          onError: () => {
            if (!run.cancelled && active === run) {
              options.onError(
                "The voice connection was interrupted. Please reconnect.",
              );
              void stop().catch(() =>
                options.onError(
                  "Could not close the connection. Please close this tab.",
                ),
              );
            }
          },
        });
        run.connection = connection;
        if (run.cancelled || active !== run || disconnected) {
          await close(connection);
          return;
        }
        try {
          connection.setVolume({ volume: 1 });
        } catch {
          /* UI offers playback recovery. */
        }
        options.onState("connected");
      } catch (cause) {
        if (run.cancelled && run.connection) run.cleanupFailed = true;
        if (!run.cancelled && active === run) {
          active = undefined;
          const denied =
            cause instanceof Error &&
            ["NotAllowedError", "PermissionDeniedError"].includes(cause.name);
          options.onError(
            denied
              ? "Microphone access was denied. Please allow it in your browser settings."
              : cause instanceof Error &&
                  Object.values(voiceErrors).includes(cause.message)
                ? cause.message
                : "Could not start the conversation. Check microphone permission and your connection.",
          );
          options.onState("error");
        }
      }
    })();
    await run.done;
  }
  function sendContext(text: string) {
    if (
      !active?.connection ||
      active.cancelled ||
      !active.connection.sendContextualUpdate
    )
      return false;
    try {
      active.connection.sendContextualUpdate(text);
      return true;
    } catch {
      return false;
    }
  }
  function sendMessage(text: string) {
    if (
      !active?.connection ||
      active.cancelled ||
      !active.connection.sendUserMessage
    )
      return false;
    try {
      active.connection.sendUserMessage(text);
      return true;
    } catch {
      return false;
    }
  }
  return { start, stop, sendContext, sendMessage };
}
