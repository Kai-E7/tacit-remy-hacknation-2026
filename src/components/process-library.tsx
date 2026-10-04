"use client";
import { PrivacyNotice } from "./privacy-notice";

import { useCallback, useEffect, useState } from "react";
import { CURRENT_USER, displayExpertName, type RecordedProcess } from "../lib/processes";
import {
  deleteProcess,
  listProcesses,
  renameProcess,
  mergeProcesses,
  saveStepRevision,
  saveRuleCorrection,
  getProcess,
  approveVersion,
  importCloudProcesses,
} from "../lib/process-store";
import { UserSelector, WorkspaceNavigation } from "./workspace-navigation";
import { WorkMapView } from "./work-map-view";
import { ensureDemoProcesses } from "../lib/demo-seed";
import { RemyHelp } from "./remy-help";
import "./process-library.css";

export function ProcessLibrary() {
  const [processes, setProcesses] = useState<RecordedProcess[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [renaming, setRenaming] = useState(false),
    [newName, setNewName] = useState("");
  const [updating, setUpdating] = useState(false);
  const [exportingHandbook, setExportingHandbook] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [merging, setMerging] = useState(false),
    [mergeTarget, setMergeTarget] = useState("");
  const [editing, setEditing] = useState(false),
    [editStep, setEditStep] = useState("");
  const [editTitle, setEditTitle] = useState(""),
    [editAction, setEditAction] = useState(""),
    [editNote, setEditNote] = useState("");
  const [correcting, setCorrecting] = useState(false),
    [correctionTarget, setCorrectionTarget] = useState(""),
    [correctionStatement, setCorrectionStatement] = useState("");
  const refresh = useCallback(async () => {
    try {
      setError("");
      const loaded = await listProcesses(CURRENT_USER.id);
      setProcesses(loaded);
      setSelectedId((current) => current && loaded.some((p) => p.id === current) ? current : (loaded[0]?.id ?? ""));
    } catch {
      setError(
        "Could not load local processes. Check browser storage and reload.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const requested =
      new URLSearchParams(window.location.search).get("process") ?? "";
    setSelectedId(requested);
    if (requested)
      void getProcess(requested, CURRENT_USER.id)
        .then((p) => {
          if (p) setSelectedId(p.id);
        })
        .catch(() => {});
    void ensureDemoProcesses().catch(() => {}).finally(() => void refresh());
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const filtered = processes.filter((process) =>
    process.title
      .toLocaleLowerCase("en")
      .includes(query.toLocaleLowerCase("en")),
  );
  const selected = processes.find((process) => process.id === selectedId);
  const version =
    selected?.versions.find((item) => item.id === versionId) ??
    selected?.versions.at(-1);
  const guidanceReady = !!selected && !selected.demo && !!version?.reviewedAt &&
    !!version.workMap && version.privacy?.engine === "presidio" && !version.privacy.imagesWithheld;

  async function renameSelected() {
    if (!selected || updating) return;
    setUpdating(true);
    setError("");
    try {
      await renameProcess(selected.id, CURRENT_USER.id, newName);
      setRenaming(false);
      setMessage("Name saved.");
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not rename the process.",
      );
    } finally {
      setUpdating(false);
    }
  }

  async function backUpSelected() {
    if (!selected || cloudBusy) return;
    setCloudBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/cloud-processes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected), cache: "no-store",
      });
      if (!response.ok) throw new Error(response.status === 422
        ? "Cloud backup needs a fully privacy-checked recording. Synthetic examples stay local."
        : "Cloud backup failed. Your browser copy is still available.");
      setMessage("Saved to the private cloud demo workspace. Your browser copy remains available.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cloud backup failed."); }
    finally { setCloudBusy(false); }
  }

  async function restoreCloud() {
    if (cloudBusy) return;
    setCloudBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/cloud-processes", { cache: "no-store" });
      if (!response.ok) throw new Error("Cloud backups are unavailable. Check the server configuration.");
      const body = await response.json() as { processes?: RecordedProcess[] };
      if (!Array.isArray(body.processes)) throw new Error("Cloud response was incomplete.");
      const outcome = await importCloudProcesses(body.processes);
      await refresh();
      setMessage(`${outcome.added} cloud backup${outcome.added === 1 ? "" : "s"} restored. ${outcome.skipped} existing browser process${outcome.skipped === 1 ? " was" : "es were"} kept unchanged.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not restore cloud backups."); }
    finally { setCloudBusy(false); }
  }

  async function mergeSelected() {
    if (!selected || !mergeTarget || updating) return;
    setUpdating(true);
    setError("");
    try {
      const result = await mergeProcesses(
        selected.id,
        mergeTarget,
        CURRENT_USER.id,
      );
      setSelectedId(result.id);
      setVersionId("");
      setMerging(false);
      setMergeTarget("");
      setMessage(
        "Grouped as versions. All recordings and sources remain available.",
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not merge versions.",
      );
    } finally {
      setUpdating(false);
    }
  }

  function chooseEditStep(id: string) {
    const step = version?.workMap?.steps.find((s) => s.id === id);
    if (!step) return;
    setEditStep(id);
    setEditTitle(step.title);
    setEditAction(step.action);
  }

  async function saveRevision() {
    if (!selected || !version || updating) return;
    setUpdating(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      await saveStepRevision(selected.id, CURRENT_USER.id, {
        baseVersionId: version.id,
        stepId: editStep,
        title: editTitle,
        action: editAction,
        note: editNote,
        versionId: id,
        now: new Date().toISOString(),
      });
      setVersionId(id);
      setEditing(false);
      setEditNote("");
      setMessage(
        "New sub-version saved. The earlier version remains in the history.",
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the revision.",
      );
    } finally {
      setUpdating(false);
    }
  }

  async function saveCorrection() {
    if (!selected || !version || updating || !correctionTarget || !correctionStatement.trim()) return;
    setUpdating(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      await saveRuleCorrection(selected.id, CURRENT_USER.id, {
        baseVersionId: version.id,
        target: correctionTarget,
        statement: correctionStatement,
        versionId: id,
        now: new Date().toISOString(),
      });
      setVersionId(id);
      setCorrecting(false);
      setCorrectionStatement("");
      setMessage("Correction saved as a new sub-version. Please review this version again before Remy uses it.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the rule correction.");
    } finally {
      setUpdating(false);
    }
  }

  async function removeProcess() {
    if (
      !selected ||
      !window.confirm(
        `Permanently delete “${selected.title}”, including all local versions and images? Only a separately saved export can restore them.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await deleteProcess(selected.id, CURRENT_USER.id);
      setSelectedId("");
      setVersionId("");
      setMessage(
        "Process and all local versions deleted. Files you exported earlier remain separate.",
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not delete the process.",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function approveSelected() {
    if (!selected || !version?.workMap || approving) return;
    const open = version.workMap.questions.length;
    if (!window.confirm(`Approve version ${version.number} as a process you have reviewed for Remy's guidance? Check its steps, decisions and boundaries first.${open ? `\n${open} open question(s) remain visible and are not confirmed rules.` : ""}`)) return;
    setApproving(true);
    setError("");
    try {
      await approveVersion(selected.id, CURRENT_USER.id, version.id);
      setMessage(`Version ${version.number} approved. Remy may use exactly this version.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not approve this version.");
    } finally {
      setApproving(false);
    }
  }

  async function exportHandbook() {
    if (!selected || !version?.workMap || exportingHandbook) return;
    setExportingHandbook(true);
    setError("");
    try {
      const { createProcessHandbook } = await import("../lib/process-handbook");
      const bytes = await createProcessHandbook(selected, version.id);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selected.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 80)}-V${version.number}-Handbook.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage(
        `Handbook for version ${version.number} created. PDF download started.`,
      );
    } catch {
      setError(
        "Could not create the handbook. The saved recording remains unchanged.",
      );
    } finally {
      setExportingHandbook(false);
    }
  }

  function exportProcess() {
    if (!selected) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(selected, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `apprentice-process-${selected.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="shell">
      <WorkspaceNavigation active="processes" />
      <main className="workspace">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> Processes
          </span>
          <UserSelector />
        </header>
        <section className="heading">
          <div>
            <div className="eyebrow">KNOWLEDGE THAT STAYS</div>
            <h1>Processes &amp; guidance.</h1>
            <p>Find a process Remy already knows, or show what you’re working on.</p>
          </div>
          <a className="button primary" href="/capture">
            Teach a new process +
          </a>
        </section>
        <div className="guide-choices" aria-label="How Remy can help">
          <button type="button" className="guide-choice" onClick={() => document.querySelector<HTMLInputElement>(".library-toolbar input")?.focus()}><span>01 · NO SCREEN NEEDED</span><strong>Explain it to me</strong><small>Choose a process below for a short, source-based explanation.</small></button>
          <a className="guide-choice" href="/guide"><span>02 · LIVE GUIDANCE</span><strong>Walk me through while I share my screen</strong><small>Remy checks whether a reviewed process covers your task before giving guidance.</small></a>
        </div>
        <div className="notice">
          <span>i</span>
          <p>
            Saved here in this browser. {process.env.NODE_ENV === "development" ? "Privacy-checked recordings can also be backed up to the private demo cloud from More options. " : "Public-demo cloud backup is disabled to keep visitors’ processes separate. "}Synthetic examples stay local.
          </p>
        </div>
        <div className="library-toolbar">
          <input
            aria-label="Search processes"
            placeholder="Search processes …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="button secondary" onClick={refresh}>
            Refresh
          </button>
          <span className="badge neutral">
            {processes.length} processes · {CURRENT_USER.name}
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="subtle">
            {message}
          </p>
        )}
        <div className="library-grid">
          <section
            className="card process-list"
            aria-label="Saved processes"
          >
            {loading ? (
              <p className="library-empty">Loading processes …</p>
            ) : filtered.length === 0 ? (
              <div className="library-empty">
                <h3>
                  {query ? "No matches." : "Your first process is waiting."}
                </h3>
                <p>
                  {query
                    ? "Try another process name."
                    : "Your recording will appear here after you stop."}
                </p>
                <a href="/capture" className="button secondary">
                  Go to recording →
                </a>
              </div>
            ) : (
              filtered.map((process) => (
                <button
                  className={`process-item ${process.demo ? "demo" : ""} ${selectedId === process.id ? "selected" : ""}`}
                  key={process.id}
                  onClick={() => {
                    setSelectedId(process.id);
                    setVersionId("");
                    setMessage("");
                    setRenaming(false);
                    setMerging(false);
                    setEditing(false);
                  }}
                >
                  <span className="badge neutral">{process.demo ? "SYNTHETIC EXAMPLE" : process.versions.at(-1)?.reviewedAt ? "REVIEWED" : "DRAFT · NOT REVIEWED"}</span>
                  <h2>{process.title}</h2>
                  <p>
                    {process.versions.length} versions ·{" "}
                    {process.versions.at(-1) ? displayExpertName(process.versions.at(-1)!.recordedBy) : ""}
                  </p>
                  <small>
                    Updated{" "}
                    {new Date(process.updatedAt).toLocaleString("en-GB")}
                  </small>
                </button>
              ))
            )}
          </section>
          <section className="card process-detail" aria-label="Process details">
            {!selected || !version ? (
              <div className="library-empty">
                <div className="spark">↳</div>
                <h3>Choose a process.</h3>
              </div>
            ) : (
              <>
                <div className="card-heading">
                  <div>
                    <h2>{selected.title}</h2>
                    <p className="subtle">
                      Shared by: {displayExpertName(version.recordedBy)}
                    </p>
                  </div>
                  <span className="badge neutral">{selected.demo ? "SYNTHETIC EXAMPLE" : "LOCAL"}</span>
                </div>
                <div className="process-detail-body">
                  <div className="button-row">
                    <button
                      className="button secondary"
                      onClick={() => {
                        setNewName(selected.title);
                        setRenaming(true);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      className="text-button danger-button"
                      disabled={deleting}
                      onClick={removeProcess}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="button-row">
                    <button
                      className="text-button"
                      disabled={processes.length < 2 || updating}
                      onClick={() => {
                        setMerging(!merging);
                        setEditing(false);
                      }}
                    >
                      Merge as a version
                    </button>
                    {version.workMap && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setEditing(!editing);
                          setMerging(false);
                          chooseEditStep(version.workMap!.steps[0].id);
                          setEditNote("");
                        }}
                      >
                        Revise this version
                      </button>
                    )}
                    {version.workMap && version.privacy?.engine === "presidio" && !version.privacy.imagesWithheld && (
                      <button className="text-button" onClick={() => {
                        setCorrecting(!correcting);
                        setEditing(false);
                        setMerging(false);
                        setCorrectionTarget(version.workMap!.guardrails.length
                          ? "guardrail:0" : `step:${version.workMap!.steps[0]?.id ?? ""}`);
                        setCorrectionStatement("");
                      }}>Correct an expert rule</button>
                    )}
                  </div>
                  {merging && (
                    <form
                      className="reference-note"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void mergeSelected();
                      }}
                    >
                      <label className="field-label">
                        Which process does this belong to?
                        <select
                          value={mergeTarget}
                          onChange={(e) => setMergeTarget(e.target.value)}
                          required
                        >
                          <option value="">Choose a process …</option>
                          {processes
                            .filter((p) => p.id !== selected.id)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <p>
                        All {selected.versions.length} versions will be grouped there.
                        Recordings, sources and original names remain available.
                        The target name becomes the shared process name.
                      </p>
                      <button
                        className="button primary"
                        disabled={updating || !mergeTarget}
                      >
                        Merge versions
                      </button>
                    </form>
                  )}
                  {editing && version.workMap && (
                    <form
                      className="reference-note"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveRevision();
                      }}
                    >
                      <strong>
                        Revising version {version.number}
                      </strong>
                      <label className="field-label">
                        Process step
                        <select
                          value={editStep}
                          onChange={(e) => chooseEditStep(e.target.value)}
                        >
                          {version.workMap.steps.map((s, i) => (
                            <option key={s.id} value={s.id}>
                              {i + 1}. {s.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">
                        Step title
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          maxLength={160}
                          required
                        />
                      </label>
                      <label className="field-label">
                        Action
                        <textarea
                          value={editAction}
                          onChange={(e) => setEditAction(e.target.value)}
                          maxLength={1500}
                          required
                        />
                      </label>
                      <label className="field-label">
                        What changed and why?
                        <textarea
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          maxLength={1000}
                          required
                        />
                      </label>
                      <p>
                        This creates a new sub-version, not a new recording.
                        Original screenshots and quotes remain unchanged; the edit is marked separately.
                        Record another run if you need new evidence.
                      </p>
                      <button className="button primary" disabled={updating}>
                        Save as new sub-version
                      </button>
                    </form>
                  )}
                  {correcting && version.workMap && (
                    <form className="reference-note" onSubmit={(e) => { e.preventDefault(); void saveCorrection(); }}>
                      <strong>Correct expert knowledge · new sub-version</strong>
                      <label className="field-label">Affected step or stop rule
                        <select value={correctionTarget} onChange={(e) => setCorrectionTarget(e.target.value)} required>
                          {version.workMap.guardrails.map((g, i) =>
                            <option key={`g${i}`} value={`guardrail:${i}`}>Stop rule {i + 1}: {g.rule}</option>)}
                          {version.workMap.steps.map((s, i) =>
                            <option key={s.id} value={`step:${s.id}`}>Step {i + 1}: {s.title}</option>)}
                        </select>
                      </label>
                      <label className="field-label">Your corrected expert statement
                        <textarea value={correctionStatement} onChange={(e) => setCorrectionStatement(e.target.value)} maxLength={500} required
                          placeholder="For example: Equipment over €8,000 is always capex." />
                      </label>
                      <p>Marked as a manual expert statement, not a new screen observation. The old version remains. Remy uses the correction only after you review it again.</p>
                      <button className="button primary" disabled={updating || !correctionTarget || !correctionStatement.trim()}>Save correction as sub-version</button>
                    </form>
                  )}
                  {renaming && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void renameSelected();
                      }}
                    >
                      <label className="field-label">
                        New process name
                        <input
                          autoFocus
                          value={newName}
                          maxLength={120}
                          onChange={(e) => setNewName(e.target.value)}
                        />
                      </label>
                      <div className="button-row">
                        <button
                          className="button primary"
                          disabled={updating || !newName.trim()}
                          type="submit"
                        >
                          Save name
                        </button>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => setRenaming(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                  <label className="field-label">
                    Recording version
                    <select
                      aria-label="Recording version"
                      value={version.id}
                      onChange={(e) => {
                        setVersionId(e.target.value);
                        setEditing(false);
                        setCorrecting(false);
                      }}
                    >
                      {selected.versions.map((item) => (
                        <option key={item.id} value={item.id}>
                          Version {item.number}
                          {item.kind === "revision"
                            ? " · revision"
                            : " · recording"}{" "}
                          · {new Date(item.createdAt).toLocaleString("en-GB")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div
                    className="version-history"
                    aria-label="Version history"
                  >
                    {selected.versions.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        aria-pressed={item.id === version.id}
                        title={`${item.kind === "revision" ? "Revision" : "Recording"} · ${new Date(item.createdAt).toLocaleString("en-GB")}`}
                        onClick={() => {
                          setVersionId(item.id);
                          setEditing(false);
                          setCorrecting(false);
                        }}
                      >
                        V{item.number}
                        {item.kind === "revision" ? " ✎" : ""}
                      </button>
                    ))}
                  </div>
                  {version.revisionNote && (
                    <p className="reference-note">
                      <strong>Revision:</strong> {version.revisionNote}
                      <br />
                      Screenshots come from the underlying recording, not a new run.
                    </p>
                  )}
                  {version.origin && (
                    <p className="subtle">
                      Originally: {version.origin.title} · version{" "}
                      {version.origin.number}
                    </p>
                  )}
                  <p className="subtle">
                    {version.workMap
                      ? version.reviewedAt
                        ? "Process map reviewed."
                        : "AI draft · not reviewed yet"
                      : "Recording saved · no process map yet"}
                  </p>
                  <p className="process-summary">
                    {version.summary || "No description added."}
                  </p>
                  <div className="guidance-cta">
                    <div>
                      <strong>How would you like Remy to help?</strong>
                      <p>{guidanceReady
                        ? "Get a quick explanation, or share your screen so Remy can check whether this reviewed process applies."
                        : selected.demo
                          ? "Explore an example explanation. Synthetic examples are not approved for live guidance."
                          : version.privacy?.imagesWithheld
                            ? "Guidance is locked: screen evidence needs privacy review. Record a new checked version before approval."
                            : "Guidance is locked until this version has a privacy check and expert review."}</p>
                    </div>
                    <div className="guidance-actions">
                      {guidanceReady ? <a className="button primary" href={`/guide?process=${encodeURIComponent(selected.id)}`}>
                        Walk me through while I share my screen.
                      </a> : <button className="button primary" disabled title="Expert review and privacy checks are required first">
                        Walk me through while I share my screen.
                      </button>}
                      {(guidanceReady || selected.demo && !!version.workMap) ? <a className="button secondary" href={`/explain?process=${encodeURIComponent(selected.id)}&version=${encodeURIComponent(version.id)}`}>
                        Explain it to me →
                      </a> : <button className="button secondary" disabled title="A reviewed process map is required first">
                        Explain it to me →
                      </button>}
                    </div>
                  </div>
                  <details className="reference-note">
                    <summary>Version & comparison context</summary>
                    <strong>Comparison context</strong>
                    <p>
                      {version.basedOnVersionId
                        ? `This run references version ${selected.versions.find((item) => item.id === version.basedOnVersionId)?.number ?? "unknown"}. The earlier recording remains unchanged.`
                        : "First recording without a reference version."}
                    </p>
                    <p>
                      Automatic conflict detection and agent follow-ups are planned.
                      Manual notes are not confirmed expert rules.
                    </p>
                  </details>
                  <div className="button-row">
                    {version.workMap && !version.reviewedAt && !selected.demo && (
                      <button className="button secondary" disabled={approving} onClick={() => void approveSelected()}>
                        {approving ? "Reviewing …" : "Approve process for Remy"}
                      </button>
                    )}
                    <a
                      className="button primary"
                      href={`/capture?process=${encodeURIComponent(selected.id)}&version=${encodeURIComponent(version.id)}`}
                    >
                      New run using this reference →
                    </a>
                    <a
                      className="button secondary"
                      href={`/interview?process=${encodeURIComponent(selected.id)}&version=${encodeURIComponent(version.id)}`}
                    >
                      Continue by voice →
                    </a>
                  </div>
                  <details className="process-more-options">
                    <summary>More options</summary>
                    <div className="button-row">
                      {process.env.NODE_ENV === "development" && <>
                        <button className="button secondary" disabled={cloudBusy || selected.demo || !selected.versions.every((item) => item.privacy?.engine === "presidio" && !item.privacy.imagesWithheld && item.privacy.status !== "manual review required")} onClick={() => void backUpSelected()}>
                          {cloudBusy ? "Working …" : "Back up to cloud"}
                        </button>
                        <button className="button secondary" disabled={cloudBusy} onClick={() => void restoreCloud()}>
                          Restore cloud backups
                        </button>
                      </>}
                      <button className="button secondary" onClick={exportProcess}>
                        Export JSON
                      </button>
                      <button
                        className="button secondary"
                        disabled={!version.workMap || exportingHandbook}
                        onClick={() => void exportHandbook()}
                      >
                        {exportingHandbook
                          ? "Creating handbook …"
                          : "Download handbook PDF ↓"}
                      </button>
                    </div>
                  </details>
                  {!selected.demo && <PrivacyNotice report={version.privacy} />}
                  {selected.demo ? <p className="caption">Synthetic example only. Mock screens and fictional dialogue; not an actual recording, privacy scan or expert-approved guide.</p> : !version.privacy && (
                    <p className="caption">
                      Older recording: not retrospectively scanned or redacted.
                    </p>
                  )}
                  <h3 className="evidence-title">
                    {version.workMap ? "Sources & transcript" : "Recording"}
                  </h3>
                  {version.workMap && (
                    <WorkMapView
                      key={version.id}
                      map={{ ...version.workMap, title: selected.title }}
                      evidence={version.evidence}
                      transcript={version.transcript ?? []}
                      editedStepIds={version.editedStepIds}
                      synthetic={selected.demo}
                      reviewed={!!version.reviewedAt}
                      speakerName={displayExpertName(version.recordedBy)}
                    />
                  )}
                  {!!version.transcript?.length && (
                    <details className="stored-evidence">
                      <summary>
                        Conversation transcript · {version.transcript.length}{" "}
                        turns
                      </summary>
                      {version.transcript.map((u) => (
                        <p key={u.id}>
                          <strong>{u.role === "user" ? displayExpertName(version.recordedBy) : "Remy"}:</strong>{" "}
                          {u.text}
                        </p>
                      ))}
                    </details>
                  )}
                  <h3 className="evidence-title">
                    Screen evidence · {version.evidence.length}
                  </h3>
                  {version.evidence.map((item, index) => (
                    <details className="stored-evidence" key={item.id}>
                      <summary>
                        {index + 1}. {item.note || "Screen moment"}{" "}
                        <small>{item.time}</small>
                      </summary>
                      <img
                        src={item.image}
                        alt={`Saved evidence ${index + 1}`}
                      />
                      <p>
                        {selected.demo ? "Synthetic mock screenshot" : "Manual note, not an AI transcript"} ·{" "}
                        {new Date(item.capturedAt).toLocaleString("en-GB")}
                      </p>
                    </details>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
      <RemyHelp processes={processes} selected={selected} />
    </div>
  );
}
