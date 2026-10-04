/** The open, overlapping forms stand for a conversation and a handoff. */
export function TacitMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M22 7H14a8 8 0 0 0 0 16h4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 29h8a8 8 0 0 0 0-16h-4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function TacitBrand() {
  return (
    <a href="/" className="brand" aria-label="Tacit — zur Aufnahme">
      <TacitMark />
      <span>tacit</span>
    </a>
  );
}
