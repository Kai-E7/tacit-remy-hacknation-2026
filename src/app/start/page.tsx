"use client";

import Image from "next/image";
import { useState } from "react";
import { UserSelector, WorkspaceNavigation } from "../../components/workspace-navigation";
import "./start.css";

export default function StartPage() {
  const [teach, setTeach] = useState(false);
  return <div className="shell"><WorkspaceNavigation active="capture"/><main className="workspace start-workspace">
    <header className="topbar"><span>Workspace <span className="slash">/</span> Meet Remy</span><UserSelector/></header>
    <section className="start-hero">
      <div className="remy-mark">
        <Image src="/brand/remy-companion-v2.png" alt="Remy, your AI apprentice" width={112} height={112} priority />
        <span aria-hidden="true">✦</span>
      </div>
      <p className="eyebrow">YOUR AI APPRENTICE</p>
      <h1>Hi, I’m Remy.</h1>
      <p className="start-subtitle">What would you like to do today?</p>
      {!teach ? <div className="start-choices">
        <button className="start-choice" onClick={() => setTeach(true)}><span className="start-choice-icon">↗</span><strong>I want to teach you how I do something.</strong><small>Show or describe your workflow. I’ll map the steps and ask why they matter.</small><span className="start-arrow">Continue →</span></button>
        <a className="start-choice" href="/processes"><span className="start-choice-icon">◎</span><strong>I would like you to guide me through a process.</strong><small>Explore what I’ve learned, or show me what you’re working on.</small><span className="start-arrow">Explore processes →</span></a>
      </div> : <div className="start-next"><button className="start-back" onClick={() => setTeach(false)}>← Back</button><h2>How would you like to teach me?</h2><div className="start-choices">
        <a className="start-choice" href="/capture"><span className="start-choice-icon">▣</span><strong>Share your screen and walk me through a process.</strong><small>Remy listens while you work and links steps to screen evidence.</small><span className="start-arrow">Share my screen →</span></a>
        <a className="start-choice" href="/interview"><span className="start-choice-icon">◉</span><strong>Talk me through a process.</strong><small>Discuss the workflow by voice and see the process map take shape.</small><span className="start-arrow">Start voice interview →</span></a>
      </div></div>}
      <p className="start-footnote">Your screen and microphone are only accessed after you choose to share them.</p>
    </section>
  </main></div>;
}
