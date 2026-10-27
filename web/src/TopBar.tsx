import type { ReactNode } from "react";
import { Link } from "react-router";
import { ShowNotesButton } from "./Sidebar.tsx";

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="editor-bar">
      <div className="editor-bar-start">
        <ShowNotesButton />
        <Link to="/" className="brand-link">
          ← <img src="/logo.svg" alt="" width={22} height={22} /> Lab Notes
        </Link>
      </div>
      <div className="editor-actions">{children}</div>
    </header>
  );
}
