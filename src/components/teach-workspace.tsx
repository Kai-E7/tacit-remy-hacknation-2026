"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CURRENT_USER, type Evidence, type RecordedProcess, type ProcessVersion } from "../lib/processes";
import { getProcess } from "../lib/process-store";
import { fitFrame } from "../lib/capture";
import { deriveInvoiceRules } from "../lib/learned-invoice-rules";
import type { Utterance } from "../lib/work-map";
import { WorkspaceNavigation, UserSelector } from "./workspace-navigation";
import { VoiceCompanion } from "./voice-companion";
import { useLearning } from "./use-learning";
import { WorkMapView } from "./work-map-view";
import "./teach-workspace.css";

export function TeachWorkspace() {
  const [selected, setSelected] = useState<{ process: RecordedProcess; version: ProcessVersion } | null>(null);
  const [ids, setIds] = useState<{ process: string; version: string } | null>(null);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [frame, setFrame] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [transcript, setTranscript] = useState<Utterance[]>([]);
  const [check, setCheck] = useState<{ status: string; message: string; quote: string } | null>(null);
  const [eventMessage, setEventMessage] = useState("");
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceStart = useRef<(() => void) | null>(null);
  const voiceStop = useRef<(() => void) | null>(null);
  const learning = useLearning({ sharing, enabled: consent, frame, capturedAt,
    evidence, transcript, onEvidence: (item) => setEvidence((current) =>
      current.some((f) => f.id === item.id) ? current : [...current, item].slice(-12)),
  });
  const abortLearning = useRef(learning.abort);
  abortLearning.current = learning.abort;

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const process = query.get("process"), version = query.get("version");
    if (!process || !version) { setError("Choose an approved process from the process library."); return; }
    setIds({ process, version });
    void getProcess(process, CURRENT_USER.id).then((record) => {
      const current = record?.versions.find((v) => v.id === version);
      if (!record || !current?.workMap || !current.reviewedAt)
        throw new Error("This process version has not been approved for Remy's guidance.");
      setSelected({ process: record, version: current });
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Process unavailable."));
  }, []);

  useEffect(() => {
    if (!ids) return;
    const channel = new BroadcastChannel("tacit-tutor-v1");
    channel.onmessage = ({ data }) => {
      if (data?.kind !== "checked" || data.processId !== ids.process || data.versionId !== ids.version ||
          !["blocked", "unverified", "clear"].includes(data.status)) return;
      const quote = typeof data.quote === "string" &&
        selected?.version.workMap &&
        [...selected.version.workMap.steps, ...selected.version.workMap.guardrails].some((source) => source.quote === data.quote)
        ? data.quote : "";
      const message = typeof data.message === "string" ? data.message.slice(0, 500) : "";
      setCheck({ status: data.status, message, quote });
      if (data.status === "blocked" && quote)
        setEventMessage(`${crypto.randomUUID()}: the learner's synthetic sandbox rejected a choice before save. Explain the mismatch with this confirmed expert quote: ${quote}`);
    };
    return () => channel.close();
  }, [ids, selected]);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    stream.current = null;
    abortLearning.current();
    voiceStop.current?.();
    setSharing(false);
    setFrame("");
  }, []);
  useEffect(() => {
    window.addEventListener("pagehide", stop);
    return () => { window.removeEventListener("pagehide", stop); stop(); };
  }, [stop]);

  async function start() {
    if (!selected || !consent || sharing || !navigator.mediaDevices?.getDisplayMedia) return;
    setError("");
    let acquired: MediaStream | undefined;
    try {
      acquired = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      stream.current = acquired;
      const track = acquired.getVideoTracks()[0];
      if (!track) throw new Error("No screen selected.");
      track.onended = stop;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = acquired;
      await video.play();
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not read the shared screen.");
      const sample = () => {
        if (!video.videoWidth || !stream.current) return;
        const size = fitFrame(video.videoWidth, video.videoHeight);
        canvas.width = size.width; canvas.height = size.height;
        ctx.drawImage(video, 0, 0, size.width, size.height);
        setFrame(canvas.toDataURL("image/jpeg", .7));
        setCapturedAt(new Date().toISOString());
      };
      setEvidence([]);
      setTranscript([]);
      setCheck(null);
      setSharing(true);
      sample();
      timer.current = setInterval(sample, 1000);
      voiceStart.current?.();
    } catch (cause) {
      acquired?.getTracks().forEach((track) => track.stop());
      setError(cause instanceof Error ? cause.message : "Screen or microphone permission failed.");
      stop();
    }
  }

  const map = selected?.version.workMap;
  const rules = map ? deriveInvoiceRules(map) : [];
  const context = map ? JSON.stringify({
    approvedVersion: selected!.version.id,
    process: selected!.process.title,
    summary: map.summary,
    steps: map.steps.map((s) => ({ id: s.id, action: s.action, decision: s.decision, reason: s.reason, expertQuote: s.quote, sourceFrame: s.frameId })),
    guardrails: map.guardrails.map((g) => ({ rule: g.rule, expertQuote: g.quote, sourceFrame: g.frameId })),
    sandboxRules: rules.map((r) => ({ kind: r.kind, threshold: r.threshold, expertQuote: r.quote })),
    observedScreen: learning.observations.slice(-2),
    lastPreSaveCheck: check,
  }) : "";

  return <div className="shell">
    <WorkspaceNavigation active="processes" />
    <main className="workspace teach-workspace">
      <header className="topbar"><span>Workspace / Follow with Remy</span><UserSelector /></header>
      <section className="heading"><div><div className="eyebrow">GUIDANCE WITH SOURCES</div><h1>Follow with Remy.</h1>
        <p>{selected ? `${selected.process.title} · approved version ${selected.version.number}` : "Choose an approved process."}</p></div>
        <a className="button secondary" href="/processes">Process library ↗</a></section>
      {error && <p className="error" role="alert">{error}</p>}
      {selected && <>
        <section className="card teach-start">
          <div><h2>New case, known expertise.</h2>
            <p>Open the synthetic practice case. Remy uses only this approved version and its sources.</p>
            <label className="checkbox"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I agree to share my screen and let Remy analyze what I choose to show.</label>
          </div>
          <div className="teach-actions">
            <a className="button secondary" target="_blank" rel="noreferrer" href={`/sandbox?process=${encodeURIComponent(selected.process.id)}&version=${encodeURIComponent(selected.version.id)}`}>Open practice case ↗</a>
            <button className="button primary" disabled={!consent || sharing} onClick={() => void start()}>Share screen & start Remy</button>
            <button className="button secondary" disabled={!sharing} onClick={stop}>Stop / Off-record</button>
          </div>
        </section>
        <div className="teach-grid">
          <section className="card teach-screen"><div className="card-heading"><h2>Learner's screen</h2><span className={`badge ${sharing ? "live" : "neutral"}`}>{sharing ? "Live" : "Off"}</span></div>
            {frame ? <img src={frame} alt="Current local screen preview" /> : <p>Select the practice-case tab in your browser.</p>}
            {learning.error && <p className="error" role="alert">{learning.error}</p>}
            {learning.observations.at(-1) && <p className="subtle">Observed: {learning.observations.at(-1)?.text}</p>}
            {check && <p className={check.status === "blocked" ? "error" : "notice"} role="status">{check.message}{check.quote && <><br />Expert: “{check.quote}”</>}</p>}
          </section>
          <VoiceCompanion role="tutor" consent={consent} canResume={sharing} startRef={voiceStart} stopRef={voiceStop}
            onActiveChange={() => {}} context={context} eventMessage={eventMessage}
            onUtterance={(utterance) => setTranscript((current) => [...current.filter((u) => u.id !== utterance.id), utterance].slice(-60))}
            onAgentEnd={stop} />
        </div>
        <section className="card teach-map"><div className="card-heading"><h2>Approved process map and source evidence</h2></div>
          <p className="subtle">Click a step to see the expert quote and screen moment.</p>
          <WorkMapView map={map!} evidence={selected.version.evidence} transcript={selected.version.transcript ?? []} reviewed />
        </section>
      </>}
    </main>
  </div>;
}
