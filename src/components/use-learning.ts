"use client";

import { useEffect, useRef, useState } from "react";
import type { Evidence } from "../lib/processes";
import { privacyImageScan } from "../lib/privacy-image";
import {
  parseObservation,
  parseWorkMap,
  type Utterance,
  type WorkMap,
} from "../lib/work-map";

const ERRORS: Record<string, string> = {
  learning_disabled:
    "AI analysis is not enabled here yet (local mode only).",
  learning_not_configured:
    "The Claude key or model is missing from the server configuration.",
  learning_permission_missing:
    "Claude denied access. Check the API permissions.",
  learning_rate_limited:
    "The AI is busy or the trial limit was reached. Wait and try again.",
};
async function call(body: object, signal: AbortSignal) {
  const response = await fetch("/api/learning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      ERRORS[data.error] ??
        "AI analysis failed. Your evidence is still available; please try again.",
    );
  return data;
}

export function useLearning(input: {
  sharing: boolean;
  enabled: boolean;
  frame: string;
  capturedAt: string;
  evidence: Evidence[];
  transcript: Utterance[];
  onEvidence(frame: Evidence): void;
}) {
  const latest = useRef(input);
  latest.current = input;
  const [map, setMap] = useState<WorkMap | null>(null);
  const [observations, setObservations] = useState<
    { frameId: string; text: string; question: string }[]
  >([]);
  const [error, setError] = useState("");
  const [observing, setObserving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const mapRequest = useRef<AbortController | null>(null);
  const lastAttempt = useRef(0),
    lastImage = useRef("");
  const attempts = useRef(0);
  const blocked = useRef(false);
  const observationRef = useRef(observations);
  observationRef.current = observations;

  function abort() {
    pending.current?.abort();
    pending.current = null;
    mapRequest.current?.abort();
    mapRequest.current = null;
    setObserving(false);
    setGenerating(false);
  }
  function reset() {
    abort();
    setMap(null);
    setConfirmed(false);
    setObservations([]);
    setError("");
    lastImage.current = "";
    lastAttempt.current = 0;
    attempts.current = 0;
    blocked.current = false;
    setLimitReached(false);
  }
  useEffect(
    () => () => {
      pending.current?.abort();
      mapRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    // Any edited/excluded source invalidates both approval and in-flight extraction.
    mapRequest.current?.abort();
    mapRequest.current = null;
    setGenerating(false);
    setMap(null);
    setConfirmed(false);
    setObservations((current) =>
      current.filter((o) => input.evidence.some((f) => f.id === o.frameId)),
    );
  }, [input.evidence, input.transcript]);
  useEffect(() => {
    if (!input.sharing || !input.enabled) {
      pending.current?.abort();
      pending.current = null;
      setObserving(false);
      return;
    }
    if (
      !input.frame ||
      pending.current ||
      blocked.current ||
      input.evidence.length >= 12 ||
      attempts.current >= 60 ||
      Date.now() - lastAttempt.current < 6000 ||
      input.frame === lastImage.current
    )
      return;
    const controller = new AbortController();
    pending.current = controller;
    lastAttempt.current = Date.now();
    attempts.current++;
    if (attempts.current >= 60) setLimitReached(true);
    const frame: Evidence = {
      id:
        input.evidence.find((f) => f.image === input.frame)?.id ??
        crypto.randomUUID(),
      image: input.frame,
      capturedAt: input.capturedAt,
      time: new Date(input.capturedAt).toLocaleTimeString("en-GB"),
      note: "",
    };
    setObserving(true);
    void privacyImageScan(frame.image, controller.signal)
      .then((reviewed) => {
        const safeFrame = { ...frame, image: reviewed.image };
        return call(
          {
            mode: "observe",
            frames: [safeFrame],
            transcript: input.transcript.slice(-25),
            previous: observationRef.current
              .slice(-3)
              .map((o) => o.text)
              .join("\n"),
          },
          controller.signal,
        ).then((data) => ({ data, safeFrame }));
      })
      .then(({ data, safeFrame }) => {
        if (
          controller.signal.aborted ||
          !latest.current.sharing ||
          !latest.current.enabled
        )
          return;
        const observation = parseObservation(data.observation);
        lastImage.current = frame.image;
        if (observation.changed && latest.current.evidence.length < 12) {
          latest.current.onEvidence(safeFrame);
          setObservations((current) =>
            [
              ...current,
              {
                frameId: safeFrame.id,
                text: observation.description,
                question: observation.question,
              },
            ].slice(-12),
          );
        }
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Bildauswertung fehlgeschlagen.",
          );
        }
      })
      .finally(() => {
        if (pending.current === controller) {
          pending.current = null;
          setObserving(false);
        }
      });
  }, [
    input.frame,
    input.capturedAt,
    input.sharing,
    input.enabled,
    input.evidence,
    input.transcript,
  ]);

  async function generate() {
    if (
      !latest.current.enabled ||
      !latest.current.evidence.length ||
      mapRequest.current
    )
      return;
    pending.current?.abort();
    pending.current = null;
    setObserving(false);
    const controller = new AbortController();
    mapRequest.current = controller;
    const { evidence, transcript } = latest.current;
    setGenerating(true);
    setError("");
    setConfirmed(false);
    setMap(null);
    try {
      const result = await call(
        { mode: "map", frames: evidence, transcript },
        controller.signal,
      );
      if (!controller.signal.aborted)
        setMap(parseWorkMap(result.map, evidence, transcript));
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Dokumentation fehlgeschlagen.",
        );
    } finally {
      if (mapRequest.current === controller) {
        mapRequest.current = null;
        setGenerating(false);
      }
    }
  }
  function retry() {
    blocked.current = false;
    setError("");
    lastAttempt.current = 0;
  }
  return {
    map,
    observations,
    error,
    observing,
    generating,
    confirmed,
    setConfirmed,
    generate,
    abort,
    reset,
    retry,
    limitReached,
  };
}
