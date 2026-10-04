"use client";
import { useEffect, useRef, useState } from "react";
import { parseWorkMap, type Utterance, type WorkMap } from "../lib/work-map";
import { privacyScan, type PrivacyReport } from "../lib/privacy";

/** Incremental, transcript-grounded drafts. Audio stays on ElevenLabs; no fake frames. */
export function useVoiceMap(active: boolean, transcript: Utterance[]) {
  const latest = useRef({ active, transcript });
  latest.current = { active, transcript };
  const [map, setMap] = useState<WorkMap | null>(null),
    [error, setError] = useState("");
  const [sourceTranscript, setSourceTranscript] = useState<Utterance[]>([]);
  const [privacy, setPrivacy] = useState<PrivacyReport | null>(null);
  const [updating, setUpdating] = useState(false),
    [updatedAt, setUpdatedAt] = useState("");
  const pending = useRef<AbortController | null>(null),
    attempted = useRef(0),
    lastAttempt = useRef(0);
  const lastSignature = useRef(""),
    blocked = useRef(false);
  function abort() {
    pending.current?.abort();
    pending.current = null;
    setUpdating(false);
  }
  function reset() {
    abort();
    setMap(null);
    setSourceTranscript([]);
    setPrivacy(null);
    setError("");
    setUpdatedAt("");
    attempted.current = 0;
    lastAttempt.current = 0;
    lastSignature.current = "";
    blocked.current = false;
  }
  useEffect(() => {
    if (!active) {
      abort();
      return;
    }
    const timer = setInterval(() => {
      const snapshot = latest.current.transcript;
      const users = snapshot.filter((u) => u.role === "user");
      const signature = users.map((u) => `${u.id}:${u.text}`).join("|");
      if (
        !latest.current.active ||
        !users.length ||
        blocked.current ||
        pending.current ||
        signature === lastSignature.current ||
        Date.now() - lastAttempt.current < 4000
      )
        return;
      if (attempted.current >= 60) {
        setError(
          "Live update limit reached. Stop to save the conversation and create the final map.",
        );
        blocked.current = true;
        return;
      }
      const controller = new AbortController();
      pending.current = controller;
      lastAttempt.current = Date.now();
      attempted.current++;
      setUpdating(true);
      let safeSnapshot: Utterance[] = [];
      void privacyScan(
        snapshot.map((u) => u.text),
        controller.signal,
      )
        .then((result) => {
          if (controller.signal.aborted || !latest.current.active)
            throw new Error("cancelled");
          setPrivacy(result.report);
          if (result.report.engine !== "presidio")
            throw new Error("manual_review_required");
          safeSnapshot = snapshot.map((u, i) => ({
            ...u,
            text: result.texts[i],
          }));
          return fetch("/api/learning", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              mode: "voice-live",
              frames: [],
              transcript: safeSnapshot,
            }),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(90000),
            ]),
          });
        })
        .then(async (r) => {
          if (!r.ok) throw new Error("live_map_failed");
          return r.json();
        })
        .then((data) => {
          if (controller.signal.aborted || !latest.current.active) return;
          if (data.map === null) {
            lastSignature.current = signature;
            setError("");
            return;
          }
          const result = parseWorkMap(data.map, [], safeSnapshot);
          setSourceTranscript(safeSnapshot);
          setMap(result);
          setUpdatedAt(new Date().toLocaleTimeString("en-GB"));
          setError("");
          lastSignature.current = signature;
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            blocked.current = true;
            setError(
              "Live diagram paused. Your conversation remains available; retry or save it at the end.",
            );
          }
        })
        .finally(() => {
          if (pending.current === controller) {
            pending.current = null;
            setUpdating(false);
          }
        });
    }, 1000);
    return () => {
      clearInterval(timer);
      pending.current?.abort();
      pending.current = null;
    };
  }, [active]);
  return {
    map,
    sourceTranscript,
    privacy,
    error,
    updating,
    updatedAt,
    abort,
    reset,
    retry: () => {
      blocked.current = false;
      lastAttempt.current = 0;
      setError("");
    },
  };
}
