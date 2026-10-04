import type { Metadata } from "next";
import styles from "./welcome.module.css";

export const metadata: Metadata = {
  title: "Tacit — Meet Remy",
  description: "The person leaves. The knowledge doesn't have to. Meet Remy.",
  robots: { index: false, follow: false },
};

export default function Welcome() {
  return (
    <main className={styles.page} lang="en">
      <header className={styles.header}>
        <span className={styles.brand}>
          tacit<span aria-hidden="true">.</span>
        </span>
        <span className={styles.invitation}>An invitation to remember</span>
      </header>
      <section className={styles.content}>
        <div className={styles.signal} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className={styles.question}>
          Tired of losing knowledge when
          <br className={styles.desktopBreak} /> an employee retires or leaves?
        </p>
        <h1 className={styles.title}>
          Capture tacit knowledge.
          <br />
          <span className={styles.remyLine}>
            <em>Meet Remy.</em>
            <img src="/brand/remy-companion-v2.png" alt="Remy, your AI apprentice" width="104" height="104" />
          </span>
        </h1>
        <p className={styles.subline}>
          Some things are never written down.
          <br />
          Until now.
        </p>
        <a className={styles.cta} href="/start">
          Meet Remy <span aria-hidden="true">↗</span>
        </a>
      </section>
      <footer className={styles.footer}>
        <span>The person leaves. The knowledge stays.</span>
        <span>Open demo · 2026</span>
      </footer>
    </main>
  );
}
