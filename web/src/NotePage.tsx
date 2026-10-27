import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError, errorMessage, getNote, type Note } from "./api.ts";
import { isValidContent } from "./editor.ts";
import { NoteEditor } from "./NoteEditor.tsx";
import { Sidebar, SidebarProvider, useSidebarState } from "./Sidebar.tsx";
import { TopBar } from "./TopBar.tsx";

type Session = { key: string; note: Note | null };

type State =
  | { status: "loading" }
  | { status: "ready"; session: Session }
  | { status: "not-found" }
  | { status: "invalid" }
  | { status: "error"; message: string };

export function NotePage() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  // The id this page just got back from POST. Navigating to it is not a new note to load.
  const createdIdRef = useRef<string | null>(null);
  const newSessionsRef = useRef(0);
  const sidebar = useSidebarState();
  // Bumped after every save so the sidebar refetches (new notes, new titles, new order).
  const [listVersion, setListVersion] = useState(0);
  const handleSaved = useCallback(() => setListVersion((v) => v + 1), []);

  useEffect(() => {
    if (id === createdIdRef.current) return;
    createdIdRef.current = null;

    if (id === "new") {
      newSessionsRef.current += 1;
      setState({ status: "ready", session: { key: `new-${newSessionsRef.current}`, note: null } });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    getNote(id).then(
      (note) => {
        if (cancelled) return;
        setState(
          isValidContent(note.content)
            ? { status: "ready", session: { key: note.id, note } }
            : { status: "invalid" },
        );
      },
      (err: unknown) => {
        if (cancelled) return;
        setState(
          err instanceof ApiError && err.status === 404
            ? { status: "not-found" }
            : { status: "error", message: errorMessage(err) },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleCreated = useCallback(
    (newId: string) => {
      createdIdRef.current = newId;
      navigate(`/notes/${newId}`, { replace: true });
    },
    [navigate],
  );

  // The sidebar sits outside the keyed editor, so switching notes doesn't reload it.
  return (
    <SidebarProvider value={sidebar}>
      <div className="note-layout">
        <Sidebar currentId={id} refresh={listVersion} />
        {/* Behind the narrow overlay the page is inert: no tabbing into the editor under it. */}
        <div className="note-main" inert={sidebar.narrow && sidebar.open}>
          {renderMain()}
        </div>
      </div>
    </SidebarProvider>
  );

  function renderMain() {
    if (state.status === "ready") {
      return (
        <NoteEditor
          key={state.session.key}
          initialNote={state.session.note}
          onCreated={handleCreated}
          onSaved={handleSaved}
        />
      );
    }
    return <StatusScreen state={state} />;
  }
}

function StatusScreen({ state }: { state: Exclude<State, { status: "ready" }> }) {
  return (
    <>
      <TopBar />
      <main className="status">
        {state.status === "loading" && <p className="muted">Loading…</p>}
        {state.status === "not-found" && <p className="muted">Note not found</p>}
        {state.status === "invalid" && (
          <p className="error" role="alert">
            This note can't be opened: its content is invalid.
          </p>
        )}
        {state.status === "error" && (
          <p className="error" role="alert">
            {state.message}
          </p>
        )}
      </main>
    </>
  );
}
