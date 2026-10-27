import type { ReactNode } from "react";
import { Link } from "react-router";

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="editor-bar">
      <Link to="/" className="brand-link">
        ← <img src="/logo.svg" alt="" width={22} height={22} /> Lab Notes
      </Link>
      <div className="editor-actions">{children}</div>
    </header>
  );
}
