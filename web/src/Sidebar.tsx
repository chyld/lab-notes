import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { CircleUser, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import { errorMessage, listNotes, type NoteSummary } from "./api.ts";
import { useUsername } from "./Auth.tsx";
import { useCompact } from "./media.ts";
import { normalizeTag, tagHue } from "./tags.ts";

const STORAGE_KEY = "lab-notes:sidebar";

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

/**
 * Open/closed. Wide screens remember the choice in this browser; narrow screens, where the sidebar
 * is an overlay, start closed on every load.
 */
export function useSidebarState(): SidebarState {
  const narrow = useCompact();
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

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dayYearFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });

/**
 * When a note was last saved, in the browser's locale and time zone: "Edited today, 3:42 PM",
 * "Edited yesterday, 9:10 AM", "Edited Oct 12, 3:42 PM" (this year), "Edited Oct 12, 2025".
 */
function editedLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date >= today) return `Edited today, ${timeFormat.format(date)}`;
  if (date >= yesterday) return `Edited yesterday, ${timeFormat.format(date)}`;
  if (date.getFullYear() === now.getFullYear()) return `Edited ${dayFormat.format(date)}, ${timeFormat.format(date)}`;
  return `Edited ${dayYearFormat.format(date)}`;
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
  // The search box. The sidebar never remounts, so this survives note switches.
  const [query, setQuery] = useState("");
  // Ids of the notes matching a query, and which query they answer; null when the box is blank
  // (or before the first answer).
  const [results, setResults] = useState<{ ids: Set<string>; query: string } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

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

  // Search 200ms after the last keystroke, and again whenever the list refreshes. A superseded
  // request is cancelled; while one is in flight (or if it fails) the previous results stay.
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      // Inside the promise, so even a URL that can't be built (a lone surrogate) is a shown error.
      Promise.resolve()
        .then(() => listNotes(query))
        .then(
          (notes) => {
            if (cancelled) return;
            setResults({ ids: new Set(notes.map((note) => note.id)), query });
            setSearchError(null);
          },
          (err: unknown) => {
            // Keep the previous results, but say they're not for this search.
            if (!cancelled) setSearchError(errorMessage(err));
          },
        );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, refresh, currentId]);

  const { narrow, open, setOpen } = sidebar;
  const close = () => setOpen(false);
  // On narrow screens the overlay gets out of the way once you navigate.
  const closeIfNarrow = () => narrow && close();
  const tokens = query.split(/\s+/).filter(Boolean);
  // A token as the search reads it: "#Home" and "#home" are the same tag.
  const tokenKey = (token: string) => (token.startsWith("#") ? `#${normalizeTag(token.slice(1))}` : token);
  const hasTag = (tag: string) => tokens.some((token) => tokenKey(token) === `#${tag}`);
  // A tag chip adds its #tag to the search, or removes it (every spelling of it) if it's there.
  const toggleTag = (tag: string) => {
    const next = (hasTag(tag) ? tokens.filter((token) => tokenKey(token) !== `#${tag}`) : [...tokens, `#${tag}`]).join(" ");
    if (next.length <= 500) setQuery(next); // the server's limit; past it, a chip does nothing
  };
  const notes = state.status === "ready" ? state.notes : [];
  const now = new Date(); // "today"/"yesterday" are judged at render (every refetch re-renders)
  // The open note is always listed, even if it doesn't match, so you can always see where you are
  // (e.g. a new note you just saved while searching).
  // A blank box shows everything at once (not a frame later, when the effect clears `results`).
  const active = query.trim() ? results : null;
  const shown = active ? notes.filter((note) => active.ids.has(note.id) || note.id === currentId) : notes;
  // "No notes match" is about the search, so it shows even while the open note is listed anyway,
  // but only for the query in the box (not a previous one whose answer is still shown).
  const noMatches = active !== null && active.ids.size === 0 && active.query === query;

  // The narrow overlay closes on Esc wherever focus is (clicking its empty area drops focus to
  // <body>), like a dialog, and hands focus back to Show notes.
  useEffect(() => {
    if (!narrow || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Not while an IME is composing (that Esc cancels the composition), and not while a modal
      // dialog is open (the unsaved-changes dialog gets that Esc).
      if (event.key !== "Escape" || event.isComposing || document.querySelector("dialog[open]")) return;
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
        <div className="sidebar-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            aria-label="Search notes"
            placeholder="Search, or #tag"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            maxLength={500}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Esc clears a non-empty search (here, not left to the browser) and must not also
              // close the narrow overlay; an empty box lets it through.
              if (event.key === "Escape" && query && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
        </div>
        {state.status === "loading" && <p className="sidebar-status muted">Loading…</p>}
        {state.status === "error" && (
          <p className="sidebar-status error" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "ready" && notes.length === 0 && <p className="sidebar-status muted">No notes yet</p>}
        {searchError && (
          <p className="sidebar-status error" role="alert">
            Couldn't search: {searchError}
          </p>
        )}
        {state.status === "ready" && notes.length > 0 && noMatches && (
          <p className="sidebar-status muted" role="status">
            No notes match
          </p>
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
                  <span className="sidebar-note-title">{note.title}</span>
                  <time className="sidebar-note-edited" dateTime={note.updatedAt} title={fullFormat.format(new Date(note.updatedAt))}>
                    {editedLabel(note.updatedAt, now)}
                  </time>
                </Link>
                {/* Beside the link, not inside it: no buttons inside a link. */}
                {note.tags.length > 0 && (
                  <div className="sidebar-tags">
                    {note.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={hasTag(tag) ? "tag-chip active" : "tag-chip"}
                        data-hue={tagHue(tag)}
                        aria-pressed={hasTag(tag)}
                        title={`Search for #${tag}`}
                        onClick={() => toggleTag(tag)}
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
        <SidebarAccount />
      </nav>
    </>
  );
}

/**
 * Who's signed in, pinned to the bottom of the sidebar, and Sign out: a real form post, so the
 * page reloads (clearing every cache) and unsaved changes get the browser's "Leave site?" first.
 */
function SidebarAccount() {
  const username = useUsername();
  return (
    <div className="sidebar-account">
      <CircleUser size={18} aria-hidden />
      <span className="sidebar-username" title={username}>
        {username}
      </span>
      <form method="post" action="/api/auth/logout">
        <button type="submit" className="tool" aria-label="Sign out" title="Sign out">
          <LogOut size={18} aria-hidden />
        </button>
      </form>
    </div>
  );
}
