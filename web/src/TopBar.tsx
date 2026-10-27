import type { ReactNode } from "react";
import { Link } from "react-router";

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="editor-bar">
      <Link to="/">← Notes</Link>
      <div className="editor-actions">{children}</div>
    </header>
  );
}
