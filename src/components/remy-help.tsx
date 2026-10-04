"use client";

import { useState, type FormEvent } from "react";
import type { RecordedProcess } from "../lib/processes";
import "./remy-help.css";

const ready = (process: RecordedProcess) => !process.demo && process.versions.some((version) =>
  version.reviewedAt && version.workMap && version.privacy?.engine === "presidio" && !version.privacy.imagesWithheld);

export function RemyHelp({ processes, selected }: { processes: RecordedProcess[]; selected?: RecordedProcess }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [colleague, setColleague] = useState("");
  const [copied, setCopied] = useState(false);
  function ask(event: FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q) return;
    const match = processes.find((process) => ready(process) &&
      (process.title.toLocaleLowerCase().includes(q.toLocaleLowerCase()) || q.toLocaleLowerCase().includes(process.title.toLocaleLowerCase())));
    // A selected map may be discussed as a whole; a typed question does not imply coverage of every subtopic.
    if (match) {
      const version = [...match.versions].reverse().find((item) => item.reviewedAt && item.workMap);
      setAnswer(`Yes — “${match.title}” has a reviewed version ${version?.number}. Open its process card for the verified steps and original sources. I won't infer a specific answer from a title match alone.`);
    } else {
      setAnswer("Sorry — I can't confirm a reviewed process that covers this yet. I won't guess. Who on your team could show me? You can draft a request below; no email is sent automatically.");
    }
    setCopied(false);
  }
  async function copyDraft() {
    const name = colleague.trim();
    if (!name) return;
    await navigator.clipboard.writeText(`Hi ${name}, could you show Remy how you handle “${question.trim() || "this process"}”? We would like to capture the steps, decisions and exceptions in a short walkthrough. Thanks!`);
    setCopied(true);
  }
  return <div className="remy-help">
    {open && <section className="remy-help-panel" aria-label="Ask Remy">
      <header><span className="remy-help-face">R</span><div><strong>Ask Remy</strong><small>Source-grounded guidance</small></div><button aria-label="Close Remy" onClick={() => setOpen(false)}>×</button></header>
      <div className="remy-help-body"><p>Hi, I’m Remy. Ask me whether a process has been covered, or open a reviewed process to work through it together.</p>
        {selected && <p className="remy-help-selected">Selected: <strong>{selected.title}</strong> · {ready(selected) ? "reviewed source available" : "not approved for guidance"}</p>}
        {answer && <p className="remy-help-answer" role="status">{answer}</p>}
        {answer.startsWith("Sorry") && <div className="remy-help-colleague"><label htmlFor="remy-colleague">Who could teach me?</label><input id="remy-colleague" value={colleague} onChange={(event) => setColleague(event.target.value)} placeholder="Colleague's first name" maxLength={80}/><button disabled={!colleague.trim()} onClick={() => void copyDraft()}>{copied ? "Request copied" : "Copy email draft"}</button><small>No email is sent by Tacit.</small></div>}
      </div>
      <form onSubmit={ask}><input aria-label="Ask Remy a question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Has this process been covered?" maxLength={300}/><button type="submit" disabled={!question.trim()}>→</button></form>
    </section>}
    <button className="remy-help-launch" aria-label={open ? "Close Remy" : "Ask Remy"} aria-expanded={open} onClick={() => setOpen(!open)}>R<span aria-hidden="true">✦</span></button>
  </div>;
}
