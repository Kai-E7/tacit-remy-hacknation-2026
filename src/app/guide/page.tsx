"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fitFrame } from "../../lib/capture";
import { CURRENT_USER, type Evidence, type RecordedProcess } from "../../lib/processes";
import { listProcesses } from "../../lib/process-store";
import type { Utterance } from "../../lib/work-map";
import { UserSelector, WorkspaceNavigation } from "../../components/workspace-navigation";
import { VoiceCompanion } from "../../components/voice-companion";
import { useLearning } from "../../components/use-learning";
import "./guide.css";

export default function GuideDiscovery() {
  const [processes, setProcesses] = useState<RecordedProcess[]>([]);
  const [candidate, setCandidate] = useState("");
  const [question, setQuestion] = useState("");
  const [colleague, setColleague] = useState("");
  const [draftCopied, setDraftCopied] = useState(false);
  const [consent, setConsent] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [frame, setFrame] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [transcript, setTranscript] = useState<Utterance[]>([]);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ covered: boolean; confidence: number; reason: string; processId?: string; versionId?: string } | null>(null);
  const [error, setError] = useState("");
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceStart = useRef<(() => void) | null>(null);
  const voiceStop = useRef<(() => void) | null>(null);
  const learning = useLearning({ sharing, enabled: consent, frame, capturedAt, evidence, transcript,
    onEvidence: (item) => setEvidence((current) => current.some((e) => e.id === item.id) ? current : [...current, item].slice(-12)) });
  const abortLearning = useRef(learning.abort);
  abortLearning.current = learning.abort;
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("process") ?? "";
    void listProcesses(CURRENT_USER.id).then((loaded) => {
      setProcesses(loaded);
      if (loaded.some((process) => process.id === requested)) setCandidate(requested);
    }).catch(() => setError("Could not load local processes."));
  }, []);
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
  useEffect(() => { window.addEventListener("pagehide", stop); return () => { window.removeEventListener("pagehide", stop); stop(); }; }, [stop]);
  async function start() {
    if (!consent || sharing || !navigator.mediaDevices?.getDisplayMedia) return;
    setError(""); setResult(null);
    let acquired: MediaStream | undefined;
    try {
      acquired = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      const track = acquired.getVideoTracks()[0];
      if (!track) throw new Error("No screen selected.");
      stream.current = acquired; track.onended = stop;
      const video = document.createElement("video"); video.muted = true; video.playsInline = true; video.srcObject = acquired; await video.play();
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Screen preview unavailable.");
      const sample = () => { if (!video.videoWidth || !stream.current) return; const size = fitFrame(video.videoWidth, video.videoHeight);
        canvas.width = size.width; canvas.height = size.height; ctx.drawImage(video, 0, 0, size.width, size.height);
        setFrame(canvas.toDataURL("image/jpeg", .7)); setCapturedAt(new Date().toISOString()); };
      setSharing(true); sample(); timer.current = setInterval(sample, 1000);
      voiceStart.current?.();
    } catch (cause) { acquired?.getTracks().forEach((track) => track.stop()); stop(); setError(cause instanceof Error ? cause.message : "Could not start screen or microphone."); }
  }
  async function check() {
    const process = processes.find((p) => p.id === candidate);
    const version = [...(process?.versions ?? [])].reverse().find((v) => v.reviewedAt && v.workMap && v.privacy?.engine === "presidio" && !v.privacy.imagesWithheld);
    if (!process || !version?.workMap || process.demo) { setResult({ covered: false, confidence: 0, reason: "This process has no expert-reviewed, privacy-checked version yet." }); return; }
    setChecking(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/guide-confidence", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ question, processTitle: process.title, summary: version.workMap.summary }) });
      const data = await response.json() as { covered?: boolean; confidence?: number; reason?: string };
      setResult({ covered: response.ok && data.covered === true && (data.confidence ?? 0) > .9, confidence: data.confidence ?? 0,
        reason: data.reason ?? "Coverage could not be verified.", processId: process.id, versionId: version.id });
    } catch { setResult({ covered: false, confidence: 0, reason: "Coverage check unavailable. Remy will not guess." }); }
    finally { setChecking(false); }
  }
  const approved = processes.filter((p) => !p.demo && p.versions.some((v) => v.reviewedAt && v.workMap && v.privacy?.engine === "presidio" && !v.privacy.imagesWithheld));
  const context = JSON.stringify({ mode: "discovery_only", instruction: "Identify what the learner needs. Do not give process-specific steps or advice; no reviewed process has been matched yet. Ask for a colleague if Remy has not learned the workflow. Do not claim to send email or save anything.", observations: learning.observations.slice(-2).map((o) => o.text) });
  return <div className="shell"><WorkspaceNavigation active="processes"/><main className="workspace guide-workspace">
    <header className="topbar"><span>Workspace / Ask Remy</span><UserSelector/></header>
    <section className="heading"><div><div className="eyebrow">GUIDANCE WITH BOUNDARIES</div><h1>Walk me through while I share my screen.</h1><p>Share your screen and describe your task. Remy only gives step-by-step guidance when the reviewed process is a high-confidence match.</p></div><a className="button secondary" href="/processes">← All processes</a></section>
    <div className="guide-discovery-grid"><section className="card guide-preview"><h2>Your screen</h2><p>Share a screen to help Remy identify the task. You can stop at any time.</p>
      <label className="checkbox"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}/>I agree to share my screen and voice with Remy for analysis of the data I choose to show.</label>
      <p className="subtle">Please avoid personal or confidential information; automatic redaction may miss it.</p>
      <div className="button-row"><button className="button primary" disabled={!consent || sharing} onClick={() => void start()}>Share my screen with Remy</button><button className="button secondary" disabled={!sharing} onClick={stop}>Stop sharing</button></div>
      {frame ? <img className="guide-frame" src={frame} alt="Local preview of your shared screen"/> : <div className="guide-frame-empty">Your screen preview will appear here.</div>}
      {learning.observations.at(-1) && <p className="subtle">Latest privacy-checked observation: {learning.observations.at(-1)?.text}</p>}
      {learning.error && <p className="error" role="alert">{learning.error}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section><div className="guide-right"><VoiceCompanion role="interviewer" consent={consent} canResume={sharing} startRef={voiceStart} stopRef={voiceStop} onActiveChange={() => {}} context={context} onUtterance={(item) => setTranscript((list) => [...list.filter((u) => u.id !== item.id), item].slice(-60))} onAgentEnd={stop}/>
      <section className="card guide-check"><h2>Can Remy guide this?</h2><p>Choose the closest reviewed process and describe your task. Jev checks relevance; expert approval and source checks are required too.</p>
        <label>Reviewed process<select value={candidate} onChange={(e) => { setCandidate(e.target.value); setResult(null); }}><option value="">Choose a process…</option>{approved.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
        {approved.length === 0 && <p className="guide-boundary">No reviewed processes yet. The synthetic examples are for exploring the interface, not for operational advice.</p>}
        <label>What do you need help with?<textarea value={question} onChange={(e) => { setQuestion(e.target.value); setResult(null); }} maxLength={400} placeholder="Describe the task or decision…"/></label>
        <button className="button primary" disabled={!candidate || !question.trim() || checking} onClick={() => void check()}>{checking ? "Checking…" : "Check coverage"}</button>
        {result && <div className={result.covered ? "guide-match" : "guide-boundary"} role="status">{result.covered ? <>A reviewed source matches this task. Jev relevance confidence: {Math.round(result.confidence * 100)}%. This checks relevance, not whether every next step is correct.<br/><a className="button primary" href={`/teach?process=${encodeURIComponent(result.processId!)}&version=${encodeURIComponent(result.versionId!)}`}>Continue with Remy →</a></> : <>I’m not sure enough to guide you safely. {result.reason} If you’re unsure too, please ask the person who recorded this process. You can name another expert to request an update; no email is sent automatically.<input aria-label="Colleague who could help" value={colleague} onChange={(e) => { setColleague(e.target.value); setDraftCopied(false); }} maxLength={80} placeholder="Colleague’s name"/>{colleague.trim() && <button type="button" className="button secondary" onClick={() => void navigator.clipboard.writeText(`Hi ${colleague.trim()}, could you show Remy how you handle “${question.trim()}”? We would like to capture the key steps, decisions and exceptions in a short walkthrough. Thanks!`).then(() => setDraftCopied(true)).catch(() => setError("Could not copy the draft. Please copy it manually."))}>{draftCopied ? "Draft copied" : "Copy email draft"}</button>}</>}</div>}
      </section></div></div>
  </main></div>;
}
