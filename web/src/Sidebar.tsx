import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { PanelLeftClose, PanelLeftOpen, Plus, X } from "lucide-react";
import { errorMessage, listNotes, type NoteSummary } from "./api.ts";

const STORAGE_KEY = "lab-notes:sidebar";
const NARROW = "(max-width: 816px)";

type SidebarState = { open: boolean; narrow: boolean; setOpen: (open: boolean) => void };

/** What `Layout` provides: the open/closed state, plus "a note was saved" to refresh the list. */
type SidebarContextValue = SidebarState & { notesChanged: () => void };

const SidebarContext = createContext<SidebarContextValue | null>(null);

export const SidebarProvider = SidebarContext.Provider;

const noop = () => {};

/** Call after a save so the sidebar refetches the list. */
export function useNotesChanged(): () => void {
  return useContext(SidebarContext)?.notesChanged ?? noop;
}

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
  /** The route's note id ("new" for an unsaved note; null on "/"). Switching notes refetches. */
  currentId: string | null;
  /** Bumped after every save, which refetches the list. */
  refresh: number;
};

export function Sidebar({ currentId, refresh }: Props) {
  const sidebar = useContext(SidebarContext)!;
  const [state, setState] = useState<State>({ status: "loading" });
  // The tag the list is filtered to. The sidebar never remounts, so this survives note switches.
  const [filter, setFilter] = useState<string | null>(null);

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
    // currentId: switching notes refetches too, so a failed first load is retried.
  }, [refresh, currentId]);

  const { narrow, open, setOpen } = sidebar;
  const close = () => setOpen(false);
  // On narrow screens the overlay gets out of the way once you navigate.
  const closeIfNarrow = () => narrow && close();
  const toggleFilter = (tag: string) => setFilter((current) => (current === tag ? null : tag));
  const notes = state.status === "ready" ? state.notes : [];
  // The open note is always listed, even without the tag, so you can always see where you are
  // (e.g. a new, untagged note you just saved while filtering).
  const shown = filter ? notes.filter((note) => note.tags.includes(filter) || note.id === currentId) : notes;

  // The narrow overlay closes on Esc wherever focus is (clicking its empty area drops focus to
  // <body>), like a dialog, and hands focus back to Show notes.
  useEffect(() => {
    if (!narrow || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      focusLater("show-notes");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [narrow, open, setOpen]);

  return (
    <>
      {narrow && open && (
        <div
          className="sidebar-backdrop"
          aria-hidden
          onClick={() => {
            close();
            focusLater("show-notes");
          }}
        />
      )}
      <nav id="notes-sidebar" className="sidebar" aria-label="Notes" hidden={!open}>
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
        {/* replace: on an unsaved new note already, don't stack another history entry. */}
        <Link to="/notes/new" replace={currentId === "new"} className="sidebar-new" onClick={closeIfNarrow}>
          <Plus size={16} aria-hidden />
          New note
        </Link>
        {filter && (
          <div className="sidebar-filter">
            Tagged
            <span className="tag-chip active">
              #{filter}
              <button
                type="button"
                className="tag-remove"
                aria-label="Clear tag filter"
                title="Clear tag filter"
                onClick={() => {
                  setFilter(null);
                  // The filter bar (and this button) goes away; keep focus in the sidebar.
                  document.querySelector<HTMLElement>(".sidebar-new")?.focus();
                }}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          </div>
        )}
        {state.status === "loading" && <p className="sidebar-status muted">Loading…</p>}
        {state.status === "error" && (
          <p className="sidebar-status error" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "ready" && notes.length === 0 && <p className="sidebar-status muted">No notes yet</p>}
        {state.status === "ready" && notes.length > 0 && shown.length === 0 && (
          <p className="sidebar-status muted">No notes tagged #{filter}</p>
        )}
        {shown.length > 0 && (
          <ul className="sidebar-notes">
            {shown.map((note) => (
              <li key={note.id}>
                <Link
                  to={`/notes/${note.id}`}
                  title={note.title}
                  aria-current={note.id === currentId ? "page" : undefined}
                  onClick={closeIfNarrow}
                >
                  {note.title}
                </Link>
                {/* Beside the link, not inside it: no buttons inside a link. */}
                {note.tags.length > 0 && (
                  <div className="sidebar-tags">
                    {note.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={tag === filter ? "tag-chip active" : "tag-chip"}
                        aria-pressed={tag === filter}
                        title={`Show notes tagged ${tag}`}
                        onClick={() => toggleFilter(tag)}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </nav>
    </>
  );
}
