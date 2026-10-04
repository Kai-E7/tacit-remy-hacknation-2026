import { CURRENT_USER } from "../lib/processes";
import { TacitBrand } from "./tacit-brand";

export function UserSelector() {
  return (
    <label className="user-selector">
      <span className="avatar">K</span>
      <span>
        <small>Your local profile</small>
        <select aria-label="Selected user" defaultValue={CURRENT_USER.id}>
          <option value={CURRENT_USER.id}>{CURRENT_USER.name}</option>
        </select>
      </span>
    </label>
  );
}

export function WorkspaceNavigation({
  active,
}: {
  active: "capture" | "processes";
}) {
  return (
    <aside className="sidebar">
      <TacitBrand />
      <nav aria-label="Workspaces">
        <a href="/start" className="nav-item">Home</a>
        <a
          href="/capture"
          className={`nav-item ${active === "capture" ? "active" : ""}`}
          aria-current={active === "capture" ? "page" : undefined}
        >
          Teach Remy
        </a>
        <a
          href="/processes"
          className={`nav-item ${active === "processes" ? "active" : ""}`}
          aria-current={active === "processes" ? "page" : undefined}
        >
          Processes &amp; guidance
        </a>
      </nav>
      <span className="brand-promise">Knowledge that stays.</span>
    </aside>
  );
}
