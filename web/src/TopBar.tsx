import type { ReactNode } from "react";
import { Link } from "react-router";
import { ShowNotesButton } from "./Sidebar.tsx";

type Props = {
  /** The open note's title, shown after the brand as a breadcrumb. */
  title?: string;
  children?: ReactNode;
};

export function TopBar({ title, children }: Props) {
  return (
    <header className="editor-bar">
      <div className="editor-bar-start">
        <ShowNotesButton />
        <Link to="/" className="brand-link">
          <img src="/logo.svg" alt="" width={24} height={24} /> <span className="brand-name">Lab Notes</span>
        </Link>
        {title !== undefined && (
          <>
            <span className="breadcrumb-sep" aria-hidden>
              /
            </span>
            <span className="breadcrumb-title" title={title}>
              {title}
            </span>
          </>
        )}
      </div>
      <div className="editor-actions">{children}</div>
    </header>
  );
}
