"use client";

import { useEffect, useState } from "react";
import { CURRENT_USER, type RecordedProcess, type ProcessVersion } from "../../lib/processes";
import { getProcess } from "../../lib/process-store";
import { WorkspaceNavigation, UserSelector } from "../../components/workspace-navigation";
import { WorkMapView } from "../../components/work-map-view";
import "./explain.css";

export default function ExplainProcess() {
  const [selected, setSelected] = useState<{ process: RecordedProcess; version: ProcessVersion } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const id = query.get("process"), versionId = query.get("version");
    if (!id || !versionId) { setError("Choose a process from the library first."); return; }
    void getProcess(id, CURRENT_USER.id).then((process) => {
      const version = process?.versions.find((item) => item.id === versionId);
      if (!process || !version?.workMap || !(process.demo || version.reviewedAt && version.privacy?.engine === "presidio" && !version.privacy.imagesWithheld))
        throw new Error("This process is not ready to explain yet. Choose a reviewed map or a synthetic example.");
      setSelected({ process, version });
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load this process."));
  }, []);
  const map = selected?.version.workMap;
  return <div className="shell"><WorkspaceNavigation active="processes"/><main className="workspace explain-workspace">
    <header className="topbar"><span>Workspace / Explain a process</span><UserSelector/></header>
    <section className="heading"><div><div className="eyebrow">A QUICK, SOURCE-BASED EXPLANATION</div><h1>Let me explain.</h1><p>No screen or microphone needed.</p></div><a className="button secondary" href="/processes">← Process library</a></section>
    {error && <p className="error" role="alert">{error}</p>}
    {!error && !selected && <p className="subtle">Loading the process …</p>}
    {selected && map && <>
      <section className="card explain-intro"><img src="/brand/remy-companion-v2.png" width="120" height="120" alt="Remy, your AI apprentice"/>
        <div><span className="eyebrow">REMY EXPLAINS</span><h2>{selected.process.title}</h2><p>{map.summary}</p>
          <small>{selected.process.demo ? "Synthetic example · illustration only, not an approved guide." : `Reviewed version ${selected.version.number} · shared by ${selected.version.recordedBy.name}. This explains the recorded process, not a new case-specific decision.`}</small>
        </div></section>
      <section className="card explain-steps"><h2>The process, in order</h2><ol>{map.steps.map((step) => <li key={step.id}><h3>{step.title}</h3><p>{step.action}</p>
        {step.reason && <p className="explain-why"><strong>Why:</strong> {step.reason}</p>}
        {step.decision && <p className="explain-decision"><strong>Decision:</strong> {step.decision}</p>}
        <small>{step.applications?.length ? `In ${step.applications.join(" / ")}` : "Application not specified"}{step.actor?.name ? ` · ${step.actor.name}` : ""}</small>
      </li>)}</ol>
        {!!map.guardrails.length && <div className="explain-guardrails"><h3>Where to pause or ask a person</h3><ul>{map.guardrails.map((rule, index) => <li key={`${rule.stepId}-${index}`}>{rule.rule}</li>)}</ul></div>}
        {!!map.questions.length && <p className="explain-open"><strong>Still to clarify:</strong> {map.questions.join(" · ")}</p>}
      </section>
      <section className="card explain-sources"><h2>Process flow and original sources</h2><p className="subtle">Click a step to see its expert words and, where available, the screen moment.</p>
        <WorkMapView map={map} evidence={selected.version.evidence} transcript={selected.version.transcript ?? []} synthetic={!!selected.process.demo} reviewed={!!selected.version.reviewedAt} speakerName={selected.version.recordedBy.name}/>
      </section>
    </>}
  </main></div>;
}
