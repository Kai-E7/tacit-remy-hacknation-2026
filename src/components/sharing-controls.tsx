"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatCaptureTime } from "../lib/sharing-source";

type PictureWindowApi = {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
};
type SharingWindow = Window & { documentPictureInPicture?: PictureWindowApi };

// Isolated styles: the control window needs no external assets or provider access.
const miniStyles = `body{margin:0;background:#f7f4ee;color:#193c32;font:14px system-ui,sans-serif}*{box-sizing:border-box}.sharing-mini{padding:18px;border:3px solid #40835b;min-height:100vh}.sharing-mini h2{font-size:16px;margin:0 0 12px}.sharing-mini p{overflow-wrap:anywhere;margin:10px 0}.sharing-mini small{display:block;color:#626d64}.sharing-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.sharing-actions button{padding:10px 12px;border:1px solid #193c32;border-radius:8px;background:white;color:#193c32;font:inherit;cursor:pointer}.sharing-actions button:first-child{background:#193c32;color:white}button:focus-visible{outline:3px solid #b66c50;outline-offset:3px}`;

export function SharingControls({
  active,
  source,
  startedAt,
  voiceStatus,
  onStop,
  onPause,
}: {
  active: boolean;
  source: string;
  startedAt: number;
  voiceStatus: string;
  onStop(): void;
  onPause(): void;
}) {
  const [supported, setSupported] = useState(false);
  const [pip, setPip] = useState<Window | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const current = useRef({ active, onStop, onPause });
  current.current = { active, onStop, onPause };
  const pipRef = useRef<Window | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    setSupported(!!(window as SharingWindow).documentPictureInPicture);
    return () => {
      mounted.current = false;
      generation.current++;
      pipRef.current?.close();
    };
  }, []);

  useEffect(() => {
    generation.current++;
    if (!active) {
      pipRef.current?.close();
      pipRef.current = null;
      setPip(null);
      setOpening(false);
      return;
    }
    setNow(Date.now());
    setError("");
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  async function openMini() {
    if (opening || !current.current.active) return;
    if (pipRef.current && !pipRef.current.closed) {
      pipRef.current.focus();
      return;
    }
    const api = (window as SharingWindow).documentPictureInPicture;
    if (!api) return;
    const revision = generation.current;
    setOpening(true);
    setError("");
    try {
      // Must stay directly inside this click, not after asynchronous screen permission.
      const child = await api.requestWindow({ width: 360, height: 265 });
      if (
        !mounted.current ||
        !current.current.active ||
        revision !== generation.current
      ) {
        child.close();
        return;
      }
      child.document.title = "Tacit · recording";
      child.document.documentElement.lang = "en";
      const style = child.document.createElement("style");
      style.textContent = miniStyles;
      child.document.head.append(style);
      child.addEventListener(
        "pagehide",
        () => {
          if (pipRef.current === child) {
            pipRef.current = null;
            if (mounted.current) setPip(null);
          }
        },
        { once: true },
      );
      pipRef.current = child;
      setPip(child);
    } catch {
      if (mounted.current && revision === generation.current)
        setError(
          "Mini controls unavailable. Use Stop in the app or your browser’s sharing bar.",
        );
    } finally {
      if (mounted.current && revision === generation.current) setOpening(false);
    }
  }

  if (!active) return null;
  const elapsed = formatCaptureTime(now - startedAt);
  return (
    <section
      className="sharing-controls"
      aria-label="Current screen sharing"
    >
      <div className="sharing-source">
        <strong>● Sharing</strong>
        <span data-testid="sharing-source">{source}</span>
        <small>
          {elapsed} · {voiceStatus}
        </small>
      </div>
      <div className="sharing-control-actions">
        {supported && (
          <button
            className="button secondary"
            disabled={opening}
            onClick={() => void openMini()}
          >
            {pip ? "Show mini controls" : "Open mini controls"}
          </button>
        )}
        <button className="button primary" onClick={onStop}>
          Stop sharing &amp; save
        </button>
      </div>
      <p className="caption">
        {supported
          ? "One screen? Keep the mini controls above your windows. "
          : ""}
        Stopping sharing from your browser also stops and saves.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {pip &&
        createPortal(
          <main className="sharing-mini">
            <h2>● Tacit · recording · {elapsed}</h2>
            <p>{source}</p>
            <small>{voiceStatus}</small>
            <div className="sharing-actions">
              <button onClick={() => current.current.onStop()}>
                Stop &amp; save
              </button>
              <button onClick={() => current.current.onPause()}>
                Pause / Off-record
              </button>
            </div>
            <small>Closing this window hides the controls; capture continues.</small>
          </main>,
          pip.document.body,
        )}
    </section>
  );
}
