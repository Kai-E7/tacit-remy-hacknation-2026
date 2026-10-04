"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { UserSelector } from "../../components/workspace-navigation";
import { TacitBrand } from "../../components/tacit-brand";
import { CURRENT_USER, type ProcessVersion } from "../../lib/processes";
import { getProcess } from "../../lib/process-store";
import { checkInvoiceBeforeSave, deriveInvoiceRules } from "../../lib/learned-invoice-rules";

export default function Sandbox() {
  const [caseId, setCaseId] = useState("expert");
  const [category, setCategory] = useState("");
  const [asset, setAsset] = useState("");
  const [feedback, setFeedback] = useState("");
  const [amount, setAmount] = useState("6400");
  const lastActivity = useRef(0);
  const reportActivity = () => {
    if (Date.now() - lastActivity.current < 500) return;
    lastActivity.current = Date.now();
    const channel = new BroadcastChannel("tacit-capture-activity-v1");
    channel.postMessage({ kind: "activity" });
    channel.close();
  };
  const [reference, setReference] = useState<ProcessVersion | null>(null);
  const [referenceError, setReferenceError] = useState("");
  const [teachIds, setTeachIds] = useState<{ process: string; version: string } | null>(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const process = query.get("process"), version = query.get("version");
    if (!process && !version) return;
    if (!process || !version) { setReferenceError("Incomplete process reference."); return; }
    setTeachIds({ process, version });
    void getProcess(process, CURRENT_USER.id).then((record) => {
      const selected = record?.versions.find((item) => item.id === version);
      if (!selected?.reviewedAt || !selected.workMap)
        throw new Error("This version has not been approved for Remy yet.");
      setReference(selected);
      setCaseId("learner");
      setAmount("7200");
    }).catch((cause) => setReferenceError(cause instanceof Error ? cause.message : "Reference unavailable."));
  }, []);
  const rules = useMemo(() => reference?.workMap ? deriveInvoiceRules(reference.workMap) : [], [reference]);
  return (
    <main className="sandbox" onKeyDown={reportActivity} onPointerDown={reportActivity}>
      <header className="sandbox-header">
        <TacitBrand />
        <span className="badge neutral">
          Practice ERP · synthetic data only
        </span>
        <UserSelector />
      </header>
      <section className="sandbox-content">
        <div className="eyebrow">INVOICE PROCESSING</div>
        <h1>
          One decision.
          <br />
          A lot of experience behind it.
        </h1>
        <p className="subtle">
          Share this tab with Remy. Explain the workflow in your own words.
        </p>
        {teachIds && (
          <p className="notice">
            {referenceError || (reference
              ? `Practice case using approved version ${reference.number} · ${rules.length} rule(s) derived from expert quotes.`
              : "Loading approved process …")}
          </p>
        )}
        <div className="card invoice">
          <div className="card-heading">
            <h2>Review invoice</h2>
            <span className="badge neutral">Draft</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!teachIds || !reference) {
                setFeedback("Not saved. Start an approved process from the process library to check the learned rules.");
                return;
              }
              const checked = checkInvoiceBeforeSave(rules, {
                amount: Number(amount), category: category as "expense" | "asset" | "review" | "",
                assetNumber: asset, equipment: true,
              });
              setFeedback(`${checked.message}${checked.source ? ` Expert quote: “${checked.source.quote}”` : ""}`);
              const channel = new BroadcastChannel("tacit-tutor-v1");
              channel.postMessage({ kind: "checked", processId: teachIds.process,
                versionId: teachIds.version, status: checked.status,
                message: checked.message, quote: checked.source?.quote ?? "" });
              channel.close();
            }}
          >
            <label>
              Practice case
              <select
                value={caseId}
                onChange={(e) => {
                  setCaseId(e.target.value);
                  setAmount(e.target.value === "expert" ? "6400" : "7200");
                  setCategory("");
                  setAsset("");
                  setFeedback("");
                }}
              >
                <option value="expert">Expert · DEMO-1042</option>
                <option value="learner">Learner · DEMO-2087</option>
              </select>
            </label>
            <div className="invoice-meta">
              <div>
                <small>Supplier</small>
                <strong>Example Machines Ltd</strong>
              </div>
              <div>
                <small>Description</small>
                <strong>
                  {caseId === "expert"
                    ? "Workshop equipment"
                    : "New assembly unit"}
                </strong>
              </div>
            </div>
            <label>
              Amount (€)
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setFeedback("");
                }}
                required
              />
            </label>
            <label>
              Classification
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setFeedback("");
                }}
                required
              >
                <option value="">Please choose</option>
                <option value="expense">Operating expense</option>
                <option value="asset">Fixed asset</option>
                <option value="review">Hold for clarification</option>
              </select>
            </label>
            <label>
              Asset number
              <input
                value={asset}
                onChange={(e) => {
                  setAsset(e.target.value);
                  setFeedback("");
                }}
                placeholder="If required by your internal policy"
              />
            </label>
            <p className="caption">
              Not real accounting. No predefined amount threshold. The expert
              explains the fictional internal rules during the interview.
            </p>
            {!!rules.length && (
              <p className="caption">Active, approved expert rule: “{rules[0].quote}”</p>
            )}
            <button className="button primary" type="submit">
              Check before saving →
            </button>
            {feedback && (
              <p className="notice" role="status">
                {feedback}
              </p>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
