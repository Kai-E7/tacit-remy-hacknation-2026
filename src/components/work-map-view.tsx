"use client";

import { useRef, useState } from "react";
import { CURRENT_USER, type Evidence } from "../lib/processes";
import type { Utterance, WorkMap } from "../lib/work-map";
import { AppBadges, ProcessFlow } from "./process-flow";

export function WorkMapView({
  map,
  evidence,
  transcript,
  editedStepIds = [],
  synthetic = false,
  reviewed = false,
  speakerName = CURRENT_USER.name,
}: {
  map: WorkMap;
  evidence: Evidence[];
  transcript: Utterance[];
  editedStepIds?: string[];
  synthetic?: boolean;
  reviewed?: boolean;
  speakerName?: string;
}) {
  const [selected, setSelected] = useState("");
  const [zoomed, setZoomed] = useState(false);
  const detailDialog = useRef<HTMLDialogElement>(null);
  const expandedDialog = useRef<HTMLDialogElement>(null);
  const step = map.steps.find((s) => s.id === selected) ?? map.steps[0];
  const index = map.steps.indexOf(step);
  const frame = evidence.find((f) => f.id === step?.frameId);
  const utterance = transcript.find((u) => u.id === step?.utteranceId);
  function openStep(id: string) {
    setSelected(id);
    setZoomed(false);
    detailDialog.current?.showModal();
  }
  return (
    <div className="work-map">
      <h3>{map.title}</h3>
      <p>{map.summary}</p>
      <ProcessFlow
        map={map}
        evidence={evidence}
        editedStepIds={editedStepIds}
        reviewed={reviewed}
        synthetic={synthetic}
        onOpen={openStep}
        onExpand={() => expandedDialog.current?.showModal()}
      />
      <dialog
        ref={expandedDialog}
        className="flow-dialog"
        aria-label="Expanded process view"
      >
        <div className="flow-dialog-head">
          <h3>{map.title}</h3>
          <button
            type="button"
            className="flow-close"
            onClick={() => expandedDialog.current?.close()}
          >
            Close ✕
          </button>
        </div>
        <ProcessFlow
          map={map}
          evidence={evidence}
          editedStepIds={editedStepIds}
          reviewed={reviewed}
          synthetic={synthetic}
          onOpen={openStep}
          expanded
        />
      </dialog>
      <dialog
        ref={detailDialog}
        className="flow-dialog"
        aria-label="Step and screen evidence"
      >
        {step && (
          <>
            <div className="flow-dialog-head">
              <div>
                <small>
                  Step {index + 1} / {map.steps.length} ·{" "}
                  {step.provenance === "explained"
                    ? "Explained, not shown"
                    : "Screen-linked"}
                </small>
                <h3>{step.title}</h3>
              </div>
              <button
                type="button"
                className="flow-close"
                onClick={() => detailDialog.current?.close()}
              >
                Close ✕
              </button>
            </div>
            <div
              className={`flow-evidence ${zoomed ? "flow-evidence-zoomed" : ""}`}
            >
              {frame ? (
                <figure>
                  <button
                    type="button"
                    className="flow-screenshot"
                    aria-label={
                      zoomed
                        ? "Shrink screenshot"
                        : "Enlarge screenshot"
                    }
                    onClick={() => setZoomed(!zoomed)}
                  >
                    <img
                      src={frame.image}
                      alt={`Screen evidence: ${step.title}`}
                    />
                  </button>
                  <figcaption>
                    {frame.time} ·{" "}
                    {step.provenance === "explained"
                      ? "Associated screen moment — this action was explained, not proven by the image."
                      : synthetic ? "Synthetic mock screenshot · not a real capture." : "Captured screen · please review the AI's step association."}{" "}
                    Click the image to {zoomed ? "shrink" : "enlarge"} it.
                  </figcaption>
                </figure>
            ) : (
              <div className="flow-transcript-source"><p className="caption">Conversation evidence · no screenshot captured</p>{step.quote && utterance ? <blockquote>“{step.quote}”<footer>{speakerName} · {new Date(utterance.at).toLocaleTimeString("en-GB")}</footer></blockquote> : <p>No source excerpt available.</p>}</div>
            )}
              <div className="flow-evidence-text">
                <AppBadges step={step} />
                <p>
                  <strong>Responsible:</strong>{" "}
                  {step.actor?.name || "To clarify"}
                </p>
                {step.actor?.quote && (
                  <details>
                    <summary>Source for responsibility</summary>
                    <blockquote>„{step.actor.quote}“</blockquote>
                  </details>
                )}
                {editedStepIds.includes(step.id) && (
                  <p className="flow-human-note">
                    ✎ Manually revised. The image and quotes support the earlier
                    recording, not automatically the corrected action.
                  </p>
                )}
                <h4 className="flow-knowledge-label">Process step</h4>
                <p>{step.action}</p>
                {step.decision && (
                  <p>
                    <strong>◇ Decision · human check:</strong>{" "}
                    {step.decision}
                    <br />
                    <small>
                      Have the expert verify the criterion. No automatic approval.
                    </small>
                  </p>
                )}
                <p>
                  <strong>Tacit knowledge · why:</strong>{" "}
                  {step.reason || "Not yet explained by the expert."}
                </p>
                {step.quote && utterance ? (
                  <blockquote>
                    „{step.quote}“
                    <footer>
                      {speakerName} · {new Date(utterance.at).toLocaleTimeString("en-GB")} {" "}
                      · exact transcript wording
                    </footer>
                  </blockquote>
                ) : (
                  <p className="caption">
                    No expert quote available for this step.
                  </p>
                )}
                {map.guardrails
                  .filter((g) => g.stepId === step.id)
                  .map((g, i) => (
                    <details className="flow-guardrail" key={i}>
                      <summary>
                        ⚑ MUST / boundary · {synthetic ? "synthetic example" : reviewed ? "expert-reviewed" : "draft rule"}: {g.rule}
                      </summary>
                      <p className="caption">
                        {synthetic ? "Illustrative only; not operational advice." : reviewed ? "Expert-reviewed association; still verify applicability to the current case." : "Stated by the expert; review the AI association. Not an active rule yet."}
                      </p>
                      <blockquote>„{g.quote}“</blockquote>
                      {evidence.some((f) => f.id === g.frameId) && (
                        <img
                          src={evidence.find((f) => f.id === g.frameId)?.image}
                          alt={`Evidence for rule: ${g.rule}`}
                        />
                      )}
                    </details>
                  ))}
              </div>
            </div>
            {map.edges.some((e) => e.from === step.id) && (
              <p className="caption">
                Next:{" "}
                {map.edges
                  .filter((e) => e.from === step.id)
                  .map(
                    (e) =>
                      `${e.label ? `${e.label}: ` : ""}${map.steps.find((s) => s.id === e.to)?.title}`,
                  )
                  .join(" · ")}
              </p>
            )}
            <div className="flow-evidence-tools">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => openStep(map.steps[index - 1].id)}
              >
                ← Previous evidence
              </button>
              <button
                type="button"
                disabled={index === map.steps.length - 1}
                onClick={() => openStep(map.steps[index + 1].id)}
              >
                Next evidence →
              </button>
            </div>
          </>
        )}
      </dialog>
      {map.questions.length > 0 && (
        <div className="map-questions">
          <h4>Still to clarify · suggested debrief questions</h4>
          <ol>
            {map.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
          <p>
            Clarify these in a new run. The current draft remains available.
          </p>
        </div>
      )}
    </div>
  );
}
