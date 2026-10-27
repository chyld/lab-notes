import { useEffect, useState } from "react";
import { Link } from "react-router";
import { errorMessage, listNotes, type NoteSummary } from "./api.ts";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; notes: NoteSummary[] };

export function NotesList() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    listNotes().then(
      (notes) => {
        if (!cancelled) setState({ status: "ready", notes });
      },
      (err: unknown) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="list-page">
      <header className="list-header">
        <h1>Notes</h1>
        <Link to="/notes/new" className="button">
          New note
        </Link>
      </header>

      {state.status === "loading" && <p className="muted">Loading…</p>}
      {state.status === "error" && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "ready" &&
        (state.notes.length === 0 ? (
          <p className="muted">No notes yet</p>
        ) : (
          <ul className="notes">
            {state.notes.map((note) => (
              <li key={note.id}>
                <Link to={`/notes/${note.id}`} title={note.title}>
                  {note.title}
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </main>
  );
}
