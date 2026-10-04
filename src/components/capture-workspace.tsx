"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CaptureGeneration,
  captureErrorMessage,
  fitFrame,
  FRAME_INTERVAL_MS,
  MAX_EVIDENCE_FRAMES,
} from "../lib/capture";
import {
  CURRENT_USER,
  referenceVersion,
  type Evidence,
  type RecordedProcess,
  type ProcessVersion,
  type RecordingInput,
} from "../lib/processes";
import { getProcess, saveRecording, saveDraftMap } from "../lib/process-store";
import { finishRecording } from "../lib/finish-recording";
import { syncProcessToCloud } from "../lib/cloud-sync";
import type { Utterance } from "../lib/work-map";
import { UserSelector, WorkspaceNavigation } from "./workspace-navigation";
import { VoiceCompanion } from "./voice-companion";
import { useLearning } from "./use-learning";
import { WorkMapView } from "./work-map-view";
import { SharingControls } from "./sharing-controls";
import { describeSharingSource } from "../lib/sharing-source";
import type { VoiceState } from "../lib/voice-session";
import { PrivacyNotice } from "./privacy-notice";

type State = "idle" | "requesting" | "sharing" | "paused" | "finished";

export function CaptureWorkspace() {
  const [state, setState] = useState<State>("idle");
  const [sharingSource, setSharingSource] = useState("");
  const [sharingStartedAt, setSharingStartedAt] = useState(0);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [consent, setConsent] = useState(false),
    [aiConsent, setAiConsent] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false),
    [voiceRevision, setVoiceRevision] = useState(0);
  const voiceStart = useRef<(() => void) | null>(null),
    voiceStop = useRef<(() => void) | null>(null);
  const [frame, setFrame] = useState(""),
    [capturedAt, setCapturedAt] = useState("");
  const [frameCount, setFrameCount] = useState(0);
  const [lastSandboxActivityAt, setLastSandboxActivityAt] = useState(0);
  const lastFrame = useRef<Evidence | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]),
    evidenceRef = useRef<Evidence[]>([]);
  const [transcript, setTranscript] = useState<Utterance[]>([]),
    transcriptRef = useRef<Utterance[]>([]);
  const accepting = useRef(false);
  const autoVoice = useRef(false);
  const [reference, setReference] = useState<{
    process: RecordedProcess;
    version: ProcessVersion;
  } | null>(null);
  const [referenceReady, setReferenceReady] = useState(false),
    [referenceError, setReferenceError] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false),
    [saved, setSaved] = useState<RecordedProcess | null>(null);
  const [retrySave, setRetrySave] = useState(false),
    [retryMap, setRetryMap] = useState(false);
  const busy = useRef(false),
    persisted = useRef(false),
    frozen = useRef<RecordingInput | null>(null);
  const finishing = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const finishRef = useRef<(withMap?: boolean) => Promise<void>>(
    async () => {},
  );
  const video = useRef<HTMLVideoElement | null>(null),
    stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null),
    generation = useRef(new CaptureGeneration());

  const addEvidence = useCallback((item: Evidence) => {
    if (!accepting.current) return;
    const existing = evidenceRef.current.findIndex((f) => f.id === item.id);
    if (existing >= 0) {
      // Vision returns a re-encoded, privacy-checked copy of the first frame.
      // Replace its transient raw preview rather than appending a duplicate ID.
      if (evidenceRef.current[existing].image !== item.image) {
        evidenceRef.current = evidenceRef.current.map((f, i) => i === existing ? item : f);
        setEvidence(evidenceRef.current);
      }
      return;
    }
    if (evidenceRef.current.length >= MAX_EVIDENCE_FRAMES ||
        evidenceRef.current.some((f) => f.image === item.image)) return;
    evidenceRef.current = [...evidenceRef.current, item];
    setEvidence(evidenceRef.current);
  }, []);
  const receiveUtterance = useCallback((item: Utterance) => {
    if (!accepting.current) return;
    transcriptRef.current = [
      ...transcriptRef.current.filter((u) => u.id !== item.id),
      item,
    ].slice(-200);
    setTranscript(transcriptRef.current);
  }, []);
  const learning = useLearning({
    sharing: state === "sharing",
    enabled: aiConsent,
    frame,
    capturedAt,
    evidence,
    transcript,
    onEvidence: addEvidence,
  });
  const abortLearning = useRef(learning.abort);
  abortLearning.current = learning.abort;
  const context = aiConsent
    ? JSON.stringify({
        observations: learning.observations.slice(-3),
        previousRecording: reference?.version.privacy?.engine === "presidio"
          ? {
              title: reference.process.title,
              summary: reference.version.summary,
              status: "unverified reference",
            }
          : undefined,
        application:
          "The user can click Stop & save. The app then saves a draft automatically. Never claim a save before the application confirms it. Respect the expert's selected question-timing preference; do not infer it from screen activity.",
      })
    : "No screen context authorized.";

  useEffect(() => {
    const channel = new BroadcastChannel("tacit-capture-activity-v1");
    channel.onmessage = ({ data }) => {
      if (data?.kind === "activity") setLastSandboxActivityAt(Date.now());
    };
    return () => channel.close();
  }, []);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search),
      id = query.get("process"),
      versionId = query.get("version");
    if (!id && !versionId) {
      setReferenceReady(true);
      return;
    }
    if (!id || !versionId) {
      setReferenceError(
        "Incomplete reference. Please open the process again.",
      );
      return;
    }
    void getProcess(id, CURRENT_USER.id)
      .then((process) => {
        if (!active) return;
        if (!process) throw new Error("Reference process not found.");
        setReference({
          process,
          version: referenceVersion(process, CURRENT_USER.id, versionId),
        });
        setReferenceReady(true);
      })
      .catch((cause) => {
        if (active)
          setReferenceError(
            cause instanceof Error
              ? cause.message
              : "Reference unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const release = useCallback(() => {
    generation.current.invalidate();
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    video.current = null;
  }, []);
  const halt = useCallback(() => {
    accepting.current = false;
    autoVoice.current = false;
    abortLearning.current();
    voiceStop.current?.();
    release();
    setFrame("");
    setState("paused");
  }, [release]);
  useEffect(() => {
    mounted.current = true;
    const onHide = () => {
      halt();
      finishing.current?.abort();
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (
        accepting.current ||
        (evidenceRef.current.length && !persisted.current) ||
        busy.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      mounted.current = false;
      accepting.current = false;
      release();
      abortLearning.current();
      finishing.current?.abort();
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [halt, release]);
  useEffect(() => {
    if (
      state === "sharing" &&
      accepting.current &&
      autoVoice.current &&
      voiceStart.current
    ) {
      autoVoice.current = false;
      voiceStart.current();
    }
  }, [state, voiceRevision]);

  async function finish(withMap = true) {
    if (busy.current || (persisted.current && !retryMap)) return;
    // Freeze exact source IDs before tearing down preview and audio. Retries reuse IDs.
    if (!frozen.current) {
      let frames = [...evidenceRef.current];
      if (
        lastFrame.current &&
        !frames.some((f) => f.id === lastFrame.current!.id || f.image === lastFrame.current!.image)
      )
        frames = [
          ...frames.slice(0, MAX_EVIDENCE_FRAMES - 1),
          lastFrame.current,
        ];
      if (!frames.length) {
        halt();
        setNotice("No recording available.");
        return;
      }
      frozen.current = {
        processId: reference?.process.id ?? crypto.randomUUID(),
        versionId: crypto.randomUUID(),
        owner: CURRENT_USER,
        title:
          reference?.process.title ??
          `Process · ${new Date().toLocaleString("en-GB")}`,
        summary: "",
        evidence: frames,
        transcript: [...transcriptRef.current],
        basedOnVersionId: reference?.version.id ?? null,
        now: new Date().toISOString(),
      };
    }
    halt();
    busy.current = true;
    setSaving(true);
    setRetrySave(false);
    setRetryMap(false);
    setError("");
    setNotice("Saving …");
    const controller = new AbortController();
    finishing.current = controller;
    try {
      const result = await finishRecording(frozen.current, {
        signal: controller.signal,
        generateMap: withMap && aiConsent,
        save: persisted.current
          ? async (input) => {
              const current = await getProcess(input.processId, input.owner.id);
              if (
                !current ||
                !current.versions.some((v) => v.id === input.versionId)
              )
                throw new Error(
                  "The recording was deleted and will not be recreated.",
                );
              return current;
            }
          : saveRecording,
        attach: (id, owner, version, title, map) =>
          saveDraftMap(id, owner, version, reference ? "" : title, map),
        onSaved: (process) => {
          const clean = process.versions.find(
            (v) => v.id === frozen.current?.versionId,
          );
          if (clean && frozen.current) {
            frozen.current = {
              ...frozen.current,
              evidence: clean.evidence,
              transcript: clean.transcript,
              title: process.title,
              privacy: clean.privacy,
            };
            evidenceRef.current = clean.evidence;
            transcriptRef.current = clean.transcript ?? [];
            lastFrame.current = null;
            setEvidence(clean.evidence);
            setTranscript(clean.transcript ?? []);
          }
          persisted.current = true;
          if (mounted.current) {
            setSaved(process);
            setState("finished");
            setNotice(
              withMap && aiConsent
                ? "Saved. Building the process map …"
                : "Saved.",
            );
          }
        },
      });
      if (mounted.current) {
        setSaved(result.process);
        void syncProcessToCloud(result.process).then((cloudSaved) => {
          if (mounted.current && cloudSaved && !result.warning)
            setNotice("Saved locally and backed up to Supabase.");
        });
        setNotice(
          result.warning ??
            `Saved. ${result.process.versions.at(-1)?.privacy?.status ?? "manual review required"}`,
        );
        setRetryMap(!!result.warning && aiConsent);
      }
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save. The recording remains in this tab.",
        );
        setNotice("");
        setRetrySave(true);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  finishRef.current = finish;

  async function start(withVoice = true) {
    if (
      busy.current ||
      voiceActive ||
      !referenceReady ||
      !consent ||
      (withVoice && !aiConsent)
    )
      return;
    if (frozen.current && !persisted.current) {
      setError("Please retry saving the recording first.");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Please use desktop Chrome on localhost or HTTPS.");
      return;
    }
    if (persisted.current) {
      evidenceRef.current = [];
      transcriptRef.current = [];
      lastFrame.current = null;
      frozen.current = null;
      persisted.current = false;
      setEvidence([]);
      setTranscript([]);
      setSaved(null);
      setVoiceRevision((v) => v + 1);
      learning.reset();
    }
    setError("");
    setNotice("");
    setRetryMap(false);
    release();
    autoVoice.current = withVoice;
    const token = generation.current.begin();
    setState("requesting");
    let acquired: MediaStream | undefined;
    try {
      acquired = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
      if (!generation.current.isCurrent(token)) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = acquired;
      const track = acquired.getVideoTracks()[0];
      if (!track) throw new Error("No video");
      setSharingSource(describeSharingSource(track));
      setSharingStartedAt(Date.now());
      track.onended = () => {
        void finishRef.current();
      };
      const source = document.createElement("video");
      source.muted = true;
      source.playsInline = true;
      source.srcObject = acquired;
      video.current = source;
      await source.play();
      if (!generation.current.isCurrent(token)) return;
      const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No canvas");
      accepting.current = true;
      const sample = () => {
        if (!generation.current.isCurrent(token) || !source.videoWidth) return;
        // A browser can switch the shared tab without replacing the track.
        setSharingSource(describeSharingSource(track));
        const size = fitFrame(source.videoWidth, source.videoHeight);
        canvas.width = size.width;
        canvas.height = size.height;
        ctx.drawImage(source, 0, 0, size.width, size.height);
        const image = canvas.toDataURL("image/jpeg", 0.7),
          at = new Date().toISOString();
        const item = {
          id: crypto.randomUUID(),
          image,
          capturedAt: at,
          time: new Date(at).toLocaleTimeString("en-GB"),
          note: "",
        };
        lastFrame.current = item;
        setFrame(image);
        setCapturedAt(at);
        setFrameCount((n) => n + 1);
        // Always retain the first real frame, even if vision is slow/unavailable.
        if (!evidenceRef.current.length) addEvidence(item);
      };
      setFrameCount(0);
      setState("sharing");
      sample();
      timer.current = setInterval(sample, FRAME_INTERVAL_MS);
    } catch (cause) {
      acquired?.getTracks().forEach((t) => t.stop());
      if (!generation.current.isCurrent(token)) return;
      release();
      setState("idle");
      setError(captureErrorMessage(cause));
    }
  }

  function discard() {
    if (!window.confirm("Discard the unsaved recording?")) return;
    halt();
    finishing.current?.abort();
    learning.reset();
    evidenceRef.current = [];
    transcriptRef.current = [];
    lastFrame.current = null;
    frozen.current = null;
    setEvidence([]);
    setTranscript([]);
    setSaved(null);
    persisted.current = false;
    setRetrySave(false);
    setRetryMap(false);
    setNotice("");
    setError("");
    setVoiceRevision((v) => v + 1);
    setState("idle");
  }
  const isCapturing = state === "sharing" || state === "requesting";
  const savedVersion = saved?.versions.find(
    (v) => v.id === frozen.current?.versionId,
  );

  return (
    <div className="shell">
      <WorkspaceNavigation active="capture" />
      <main className="workspace simple-capture">
        <header className="topbar">
          <span>
            Workspace <span className="topbar-divider">/</span> New recording
          </span>
          <UserSelector />
        </header>
        <section className="heading">
          <div>
            <div className="eyebrow">YOUR KNOWLEDGE. REMY’S FIRST LESSON.</div>
            <h1>Teach Remy a process.</h1>
            <p>Show the steps. Remy asks about the reasons and exceptions.</p>
          </div>
          <a
            className="button secondary sandbox-link"
            href="/sandbox"
            target="_blank"
            rel="noreferrer"
          >
            Open practice ERP ↗
          </a>
        </section>
        <p className="capture-mode-switch">
          <a
            className="button secondary"
            href={
              reference
                ? `/interview?process=${reference.process.id}&version=${reference.version.id}`
                : "/interview"
            }
          >
            Talk it through · live diagram ↗
          </a>
        </p>
        <PrivacyNotice report={saved?.versions.at(-1)?.privacy} />
        {referenceError && (
          <p className="error" role="alert">
            {referenceError} <a href="/processes">Processes</a>
          </p>
        )}
        {reference && (
          <p className="subtle">
            Reference: {reference.process.title} · version{" "}
            {reference.version.number}
          </p>
        )}
        <section className="card quick-start">
          <div className="quick-consents">
            <h2 className="consent-title">Before we begin</h2>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={consent}
                disabled={isCapturing || saving}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I have permission to show the data on my screen.
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={aiConsent}
                disabled={saving}
                onChange={(e) => {
                  if (!e.target.checked) {
                    halt();
                  }
                  setAiConsent(e.target.checked);
                }}
              />
              Allow AI voice and screen analysis. Stop saves automatically.
            </label>
            <p className="caption">
              Voice: ElevenLabs · screen and transcript: Claude · local storage
            </p>
            <p className="start-hint">
              Next, choose a tab or window and allow microphone access.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button primary"
              disabled={
                !consent ||
                !aiConsent ||
                !referenceReady ||
                isCapturing ||
                voiceActive ||
                saving ||
                retrySave
              }
              onClick={() => void start()}
            >
              {saved ? "New recording" : "Start recording"}
            </button>
            <button
              className="button secondary"
              disabled={
                saving ||
                (!isCapturing && !voiceActive && !evidence.length) ||
                !!saved
              }
              onClick={() => void finish()}
            >
              Stop &amp; save
            </button>
            <button
              className="button secondary pause-button"
              disabled={!isCapturing && !voiceActive}
              onClick={halt}
            >
              Pause / Off-record
            </button>
          </div>
          {notice && (
            <p role="status" className="saved-message">
              {notice}{" "}
              {saved && (
                <a
                  href={`/processes?process=${encodeURIComponent(saved.id)}`}
                  aria-disabled={saving}
                  onClick={(event) => {
                    if (saving) event.preventDefault();
                  }}
                >
                  Open process →
                </a>
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {retrySave && (
            <button className="button primary" onClick={() => void finish()}>
              Retry saving
            </button>
          )}
          {retryMap && (
            <button
              className="text-button"
              disabled={saving}
              onClick={() => void finish()}
            >
              Retry process map
            </button>
          )}
        </section>
        <div className="capture-grid">
          <section className="card screen-card">
            <div className="card-heading">
              <h2>Shared screen</h2>
              <span
                className={`badge ${state === "sharing" ? "live" : "neutral"}`}
              >
                {state === "sharing"
                  ? "Recording"
                  : state === "requesting"
                    ? "Choose a tab …"
                    : "Off"}
              </span>
            </div>
            <SharingControls
              active={state === "sharing"}
              source={sharingSource}
              startedAt={sharingStartedAt}
              voiceStatus={
                voiceState === "connected"
                  ? "Remy connected"
                  : voiceState === "starting"
                    ? "Connecting Remy …"
                    : "Remy not connected"
              }
              onStop={() => {
                void finishRef.current();
              }}
              onPause={halt}
            />
            <div
              className={`screen-preview ${state === "sharing" ? "screen-preview-sharing" : ""}`}
            >
              {frame ? (
                <img src={frame} alt="Current shared screen" />
              ) : (
                <div className="screen-empty">
                  <div className="monitor-icon" aria-hidden="true">
                    <span />
                  </div>
                  <h3>
                    {state === "paused"
                      ? "Recording paused."
                      : "Share a tab or window."}
                  </h3>
                  <p>Your shared screen appears here.</p>
                </div>
              )}
            </div>
            <div className="screen-footer">
              <span>{frameCount} screenshots · 1 per second</span>
              <span>
                {learning.observing
                  ? "Remy is observing …"
                  : `${evidence.length} evidence frames`}
              </span>
            </div>
            {learning.observations.length > 0 && (
              <p className="caption" data-testid="screen-observation-count" aria-live="polite">
                Remy noticed {learning.observations.length} relevant screen {learning.observations.length === 1 ? "moment" : "moments"}.
              </p>
            )}
            {learning.error && (
              <p className="error" role="alert">
                {learning.error}{" "}
                <button className="text-button" onClick={learning.retry}>
                  Retry
                </button>
              </p>
            )}
          </section>
          <VoiceCompanion
            key={voiceRevision}
            stopRef={voiceStop}
            startRef={voiceStart}
            consent={consent && aiConsent}
            canResume={state === "sharing"}
            onActiveChange={setVoiceActive}
            onVoiceStateChange={setVoiceState}
            context={context}
            proposedQuestion={learning.observations.at(-1)?.question
              ? { id: learning.observations.at(-1)!.frameId, text: learning.observations.at(-1)!.question }
              : undefined}
            lastSandboxActivityAt={lastSandboxActivityAt}
            onUtterance={receiveUtterance}
            onAgentEnd={() => {
              void finishRef.current();
            }}
          />
        </div>
        {savedVersion?.workMap && (
          <section className="card saved-map">
            <WorkMapView
              map={savedVersion.workMap}
              evidence={savedVersion.evidence}
              transcript={savedVersion.transcript ?? []}
            />
          </section>
        )}
        <details className="capture-options">
          <summary>Options &amp; recording details</summary>
          <p className="caption">
            Screenshots, not video. Up to 12 checked evidence frames and 200
            spoken turns. Images that fail privacy checks are withheld.
            Automatic maps remain unreviewed drafts.
          </p>
          {(evidence.length >= 12 ||
            transcript.length >= 200 ||
            learning.limitReached) && (
            <p className="error">
              Limit reached. Please stop and save this part of the process.
            </p>
          )}
          <div className="button-row">
            <button
              className="button secondary"
              disabled={
                !consent || isCapturing || voiceActive || saving || retrySave
              }
              onClick={() => void start(false)}
            >
              Start screen only
            </button>
          </div>
          <p className="caption">
            Off-record stops transmission; it cannot erase data already sent to a provider.
          </p>
          {!!evidence.length && (
            <div className="evidence-list">
              {evidence.map((item, i) => (
                <details key={item.id} className="stored-evidence">
                  <summary>
                    Image {i + 1} · {item.time}
                  </summary>
                  <img src={item.image} alt={`Evidence ${i + 1}`} />
                  {!saved && !frozen.current && (
                    <button
                      className="text-button"
                      onClick={() => {
                        halt();
                        lastFrame.current = null;
                        evidenceRef.current = evidenceRef.current.filter(
                          (f) => f.id !== item.id,
                        );
                        setEvidence(evidenceRef.current);
                      }}
                    >
                      Exclude this frame
                    </button>
                  )}
                </details>
              ))}
            </div>
          )}
          <button className="text-button" disabled={saving} onClick={discard}>
            Discard unsaved recording
          </button>
        </details>
      </main>
    </div>
  );
}
