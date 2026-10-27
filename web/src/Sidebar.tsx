import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { errorMessage, listNotes, type NoteSummary } from "./api.ts";

const STORAGE_KEY = "lab-notes:sidebar";
const NARROW = "(max-width: 816px)";

type SidebarState = { open: boolean; narrow: boolean; setOpen: (open: boolean) => void };

const SidebarContext = createContext<SidebarState | null>(null);

export const SidebarProvider = SidebarContext.Provider;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/**
 * Open/closed. Wide screens remember the choice in this browser; narrow screens, where the sidebar
 * is an overlay, start closed on every load.
 */
export function useSidebarState(): SidebarState {
  const narrow = useNarrow();
  const [wideOpen, setWideOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "closed";
    } catch {
      return true; // storage unavailable: just not remembered
    }
  });
  const [narrowOpen, setNarrowOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, wideOpen ? "open" : "closed");
    } catch {
      // not remembered
    }
  }, [wideOpen]);

  const setOpen = useCallback((open: boolean) => (narrow ? setNarrowOpen(open) : setWideOpen(open)), [narrow]);
  return useMemo(() => ({ open: narrow ? narrowOpen : wideOpen, narrow, setOpen }), [narrow, narrowOpen, wideOpen, setOpen]);
}

// The two toggle buttons replace each other, so focus moves to whichever is shown now.
const focusLater = (id: string) => setTimeout(() => document.getElementById(id)?.focus());

/** The top bar's "Show notes" button, shown only while the sidebar is hidden. */
export function ShowNotesButton() {
  const sidebar = useContext(SidebarContext);
  if (!sidebar || sidebar.open) return null;
  return (
    <button
      id="show-notes"
      type="button"
      className="tool"
      aria-label="Show notes"
      title="Show notes"
      aria-expanded={false}
      aria-controls="notes-sidebar"
      onClick={() => {
        sidebar.setOpen(true);
        focusLater("hide-notes");
      }}
    >
      <PanelLeftOpen size={18} aria-hidden />
    </button>
  );
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; notes: NoteSummary[] };

type Props = {
  /** The route's note id ("new" for an unsaved note). */
  currentId: string;
  /** Bumped after every save, which refetches the list. */
  refresh: number;
};

export function Sidebar({ currentId, refresh }: Props) {
  const sidebar = useContext(SidebarContext)!;
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    listNotes().then(
      (notes) => {
        if (!cancelled) setState({ status: "ready", notes });
      },
      (err: unknown) => {
        // A failed refresh keeps the list already shown.
        if (!cancelled) setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: errorMessage(err) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const close = () => sidebar.setOpen(false);

  return (
    <>
      {sidebar.narrow && sidebar.open && <div className="sidebar-backdrop" aria-hidden onClick={close} />}
      <nav
        id="notes-sidebar"
        className="sidebar"
        aria-label="Notes"
        hidden={!sidebar.open}
        onKeyDown={(event) => {
          // The narrow overlay closes on Esc, like a dialog.
          if (event.key !== "Escape" || !sidebar.narrow) return;
          event.preventDefault();
          close();
          focusLater("show-notes");
        }}
      >
        <div className="sidebar-header">
          <span className="sidebar-title">Notes</span>
          <button
            id="hide-notes"
            type="button"
            className="tool"
            aria-label="Hide notes"
            title="Hide notes"
            aria-expanded
            aria-controls="notes-sidebar"
            onClick={() => {
              close();
              focusLater("show-notes");
            }}
          >
            <PanelLeftClose size={18} aria-hidden />
          </button>
        </div>
        {state.status === "loading" && <p className="sidebar-status muted">Loading…</p>}
        {state.status === "error" && (
          <p className="sidebar-status error" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "ready" && state.notes.length === 0 && <p className="sidebar-status muted">No notes yet</p>}
        {state.status === "ready" && state.notes.length > 0 && (
          <ul className="sidebar-notes">
            {state.notes.map((note) => (
              <li key={note.id}>
                <Link
                  to={`/notes/${note.id}`}
                  title={note.title}
                  aria-current={note.id === currentId ? "page" : undefined}
                  // On narrow screens the overlay gets out of the way once a note is picked.
                  onClick={() => sidebar.narrow && close()}
                >
                  {note.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </>
  );
}
