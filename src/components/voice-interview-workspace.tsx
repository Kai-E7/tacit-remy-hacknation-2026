"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CURRENT_USER,
  referenceVersion,
  type RecordedProcess,
  type RecordingInput,
} from "../lib/processes";
import { getProcess, saveRecording, saveDraftMap } from "../lib/process-store";
import { syncProcessToCloud } from "../lib/cloud-sync";
import { finishRecording } from "../lib/finish-recording";
import type { Utterance } from "../lib/work-map";
import { UserSelector, WorkspaceNavigation } from "./workspace-navigation";
import { VoiceCompanion } from "./voice-companion";
import { WorkMapView } from "./work-map-view";
import { useVoiceMap } from "./use-voice-map";
import "./voice-interview.css";
import { PrivacyNotice } from "./privacy-notice";

export function VoiceInterviewWorkspace() {
  const [consent, setConsent] = useState(false),
    [aiConsent, setAiConsent] = useState(false);
  const [active, setActive] = useState(false),
    [voiceActive, setVoiceActive] = useState(false),
    [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<Utterance[]>([]),
    transcriptRef = useRef<Utterance[]>([]);
  const accepting = useRef(false),
    mounted = useRef(true),
    saving = useRef(false);
  const voiceStart = useRef<(() => void) | null>(null),
    voiceStop = useRef<(() => void) | null>(null);
  const [saved, setSaved] = useState<RecordedProcess | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(false),
    frozen = useRef<RecordingInput | null>(null),
    persisted = useRef(false);
  const finishRequest = useRef<AbortController | null>(null);
  const [reference, setReference] = useState<{
      process: RecordedProcess;
      versionId: string;
    } | null>(null),
    [ready, setReady] = useState(false);
  const live = useVoiceMap(active && aiConsent, transcript);
  const liveAbort = useRef(live.abort);
  liveAbort.current = live.abort;
  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams(location.search),
      id = query.get("process"),
      version = query.get("version");
    if (!id && !version) {
      setReady(true);
      return;
    }
    if (!id || !version) {
      setError(
        "Incomplete reference. Please open the process again.",
      );
      return;
    }
    void getProcess(id, CURRENT_USER.id)
      .then((process) => {
        if (!alive) return;
        if (!process) throw new Error("Reference process unavailable.");
        referenceVersion(process, CURRENT_USER.id, version);
        setReference({ process, versionId: version });
        setReady(true);
      })
      .catch(() => {
        if (alive)
          setError(
            "Reference unavailable. Please open the process again.",
          );
      });
    return () => {
      alive = false;
    };
  }, []);
  const pause = useCallback(() => {
    accepting.current = false;
    setActive(false);
    liveAbort.current();
    voiceStop.current?.();
  }, []);
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      pause();
      finishRequest.current?.abort();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (
        accepting.current ||
        saving.current ||
        (!persisted.current && transcriptRef.current.length)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("beforeunload", unload);
    return () => {
      mounted.current = false;
      accepting.current = false;
      voiceStop.current?.();
      finishRequest.current?.abort();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("beforeunload", unload);
    };
  }, [pause]);
  const receive = useCallback((u: Utterance) => {
    if (!accepting.current) return;
    transcriptRef.current = [
      ...transcriptRef.current.filter((item) => item.id !== u.id),
      u,
    ].slice(-200);
    setTranscript(transcriptRef.current);
  }, []);
  function start() {
    if (
      !consent ||
      !aiConsent ||
      !ready ||
      saving.current ||
      voiceActive ||
      (frozen.current && !persisted.current)
    )
      return;
    if (persisted.current) {
      transcriptRef.current = [];
      setTranscript([]);
      frozen.current = null;
      persisted.current = false;
      setSaved(null);
      live.reset();
    }
    setError("");
    setMessage("");
    setRetry(false);
    accepting.current = true;
    setActive(true);
    voiceStart.current?.();
  }
  async function finish() {
    if (saving.current || (persisted.current && !retry)) return;
    pause();
    if (!transcriptRef.current.some((u) => u.role === "user")) {
      setMessage(
        "No explanation recorded yet. Start and describe a step.",
      );
      return;
    }
    frozen.current ??= {
      processId: reference?.process.id ?? crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      owner: CURRENT_USER,
      title:
        reference?.process.title ??
        `Voice process · ${new Date().toLocaleString("en-GB")}`,
      summary: "",
      recordingMode: "voice",
      evidence: [],
      transcript: [...transcriptRef.current],
      basedOnVersionId: reference?.versionId ?? null,
      now: new Date().toISOString(),
    };
    const controller = new AbortController();
    finishRequest.current = controller;
    saving.current = true;
    setBusy(true);
    setError("");
    setRetry(false);
    try {
      const result = await finishRecording(frozen.current, {
        signal: controller.signal,
        generateMap: aiConsent,
        save: persisted.current
          ? async (input) => {
              const p = await getProcess(input.processId, input.owner.id);
              if (!p?.versions.some((v) => v.id === input.versionId))
                throw new Error(
                  "The recording was deleted and will not be recreated.",
                );
              return p;
            }
          : saveRecording,
        attach: (id, owner, version, title, map) =>
          saveDraftMap(id, owner, version, reference ? "" : title, map),
        onSaved: (p) => {
          const clean = p.versions.find(
            (v) => v.id === frozen.current?.versionId,
          );
          if (clean && frozen.current) {
            frozen.current = {
              ...frozen.current,
              transcript: clean.transcript,
              privacy: clean.privacy,
            };
            transcriptRef.current = clean.transcript ?? [];
            setTranscript(transcriptRef.current);
          }
          persisted.current = true;
          if (mounted.current) {
            setSaved(p);
            setMessage(
              "Conversation saved. Building the final diagram …",
            );
          }
        },
      });
      if (mounted.current) {
        setSaved(result.process);
        void syncProcessToCloud(result.process).then((cloudSaved) => {
          if (mounted.current && cloudSaved && !result.warning)
            setMessage("Saved locally and backed up to Supabase — including the process diagram.");
        });
        setMessage(result.warning ?? "Saved locally — including the process diagram.");
        setRetry(!!result.warning);
      }
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error ? cause.message : "Could not save the recording.",
        );
        setRetry(true);
      }
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const savedVersion = saved?.versions.find(
    (v) => v.id === frozen.current?.versionId,
  );
  const displayMap = savedVersion?.workMap ?? live.map;
  const context = JSON.stringify({
    mode: "Voice-only interview. No screen is shared; never claim to see a screen. Ask the expert to describe one workflow. After completed explanations acknowledge the concrete step or ask one useful follow-up. An incremental unreviewed diagram is built from actual user utterances. Before wrap-up always ask if the process is complete, then summarize and clarify. Stop saves locally.",
    responsibilitiesToClarify:
      live.map?.steps.filter((s) => !s.actor?.name).map((s) => s.title) ?? [],
    responsibilityGuidance:
      "For an unassigned step, ask who performs it at the next natural turn only in questions-as-we-go mode; in questions-at-the-end mode, hold it for debrief. Let the expert name the responsible person or role; do not suggest or assume one. One role can perform several steps. If a role was already assigned in the actual conversation, do not repeat the question merely because diagram extraction has not caught up.",
    unansweredQuestions: live.map?.questions ?? [],
    reference: reference?.process.versions.find(v => v.id === reference.versionId)?.privacy?.engine === "presidio"
      ? {
          title: reference.process.title,
          map: reference.process.versions.find(
            (v) => v.id === reference.versionId,
          )?.workMap,
          status: "unreviewed reference; never treat as approved rules",
        }
      : undefined,
  });
  return (
    <div className="shell">
      <WorkspaceNavigation active="capture" />
      <main className="workspace voice-interview">
        <PrivacyNotice report={savedVersion?.privacy ?? live.privacy} />
        <header className="topbar">
          <span>Workspace / Voice → process</span>
          <UserSelector />
        </header>
        <section className="heading">
          <div>
            <div className="eyebrow">EXPLAIN. UNDERSTAND. MAP.</div>
            <h1>Talk me through your process.</h1>
            <p>Speak with Remy. Your process diagram grows with the conversation.</p>
          </div>
          <a
            className="button secondary"
            href={
              reference
                ? `/capture?process=${reference.process.id}&version=${reference.versionId}`
                : "/capture"
            }
          >
            Share a screen instead ↗
          </a>
        </section>
        {reference && (
          <p className="subtle">
            New version of: {reference.process.title}
          </p>
        )}
        <section className="card voice-start-bar">
          <div className="voice-consents">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={consent}
                disabled={active || busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I have permission to share the information I discuss.
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={aiConsent}
                disabled={busy}
                onChange={(e) => {
                  if (!e.target.checked) pause();
                  setAiConsent(e.target.checked);
                }}
              />
              Allow AI voice interview. Stop saves automatically.
            </label>
            <p className="caption">
              Voice: ElevenLabs · process map: Claude · local storage · no screen access
            </p>
          </div>
          <div className="button-row">
            <button
              className="button primary"
              disabled={
                !consent ||
                !aiConsent ||
                !ready ||
                active ||
                voiceActive ||
                busy ||
                (retry && !persisted.current)
              }
              onClick={start}
            >
              {saved
                ? "New interview"
                : transcript.length
                  ? "Resume interview"
                  : "Start interview"}
            </button>
            <button
              className="button secondary"
              disabled={busy || !!saved || (!active && !transcript.length)}
              onClick={() => void finish()}
            >
              Stop &amp; save
            </button>
            <button
              className="button secondary"
              disabled={!active || busy}
              onClick={pause}
            >
              Pause / Off-record
            </button>
          </div>
          {message && (
            <p role="status">
              {message}{" "}
              {saved && (
                <a
                  href={`/processes?process=${saved.id}`}
                  onClick={(e) => {
                    if (busy) e.preventDefault();
                  }}
                >
                  Open process →
                </a>
              )}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {retry && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void finish()}
            >
              Retry save / diagram
            </button>
          )}
        </section>
        <div className="voice-live-grid">
          <section className="card voice-live-map">
            <div className="card-heading">
              <div>
                <span className="eyebrow">LIVE PROCESS DIAGRAM</span>
                <h2>From conversation to flow.</h2>
              </div>
              <span className="badge neutral">
                {live.updating
                  ? "Updating …"
                  : active
                    ? "Listening"
                    : "Draft"}
              </span>
            </div>
            <div className="voice-map-body">
              {displayMap ? (
                <WorkMapView
                  map={displayMap}
                  evidence={[]}
                  transcript={savedVersion?.transcript ?? live.sourceTranscript}
                />
              ) : (
                <div className="voice-map-empty">
                  <div className="voice-map-preview" aria-hidden="true">
                    <span>Step</span>
                    <i>→</i>
                    <span>Decision</span>
                    <i>→</i>
                    <span>Outcome</span>
                  </div>
                  <h3>Tell me how it begins.</h3>
                  <p>
                    Supported steps appear here after your first explanation.
                    Remy asks about reasons and exceptions.
                  </p>
                </div>
              )}
              <p className="caption">
                Live draft · new statements are added as you speak. Explained,
                not observed on screen.
                {live.updatedAt ? ` Updated: ${live.updatedAt}.` : ""}
              </p>
              {live.error && (
                <p className="error" role="alert">
                  {live.error}{" "}
                  <button className="text-button" onClick={live.retry}>
                    Retry
                  </button>
                </p>
              )}
            </div>
          </section>
          <VoiceCompanion
            stopRef={voiceStop}
            startRef={voiceStart}
            consent={consent && aiConsent}
            canResume={active}
            onActiveChange={setVoiceActive}
            onVoiceStateChange={(next) => {
              if (next === "error") {
                accepting.current = false;
                setActive(false);
                liveAbort.current();
              } else if (next === "connected" && consent && aiConsent && !persisted.current) {
                accepting.current = true;
                setActive(true);
              }
            }}
            context={context}
            onUtterance={receive}
            onAgentEnd={() => void finish()}
          />
        </div>
      </main>
    </div>
  );
}
