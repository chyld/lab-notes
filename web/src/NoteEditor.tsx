import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { createNote, errorMessage, updateNote, type Note } from "./api.ts";
import { extensions } from "./editor.ts";
import { TopBar } from "./TopBar.tsx";

type Props = {
  initialNote: Note | null;
  onCreated: (id: string) => void;
};

export function NoteEditor({ initialNote, onCreated }: Props) {
  // Bumped on every document change; the note is dirty while it differs from savedVersion.
  const [version, setVersion] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);
  const noteIdRef = useRef(initialNote?.id ?? null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // No deps argument: deps would destroy and recreate the editor.
  const editor = useEditor({
    extensions,
    content: initialNote?.content ?? "",
    autofocus: initialNote ? false : "end",
    onUpdate: () => {
      versionRef.current += 1;
      setVersion(versionRef.current);
    },
  });

  const dirty = version !== savedVersion;

  async function save() {
    if (!editor || saving) return;
    const startVersion = versionRef.current;
    const content = editor.getJSON();
    setSaving(true);
    setError(null);
    try {
      const id = noteIdRef.current;
      if (id) {
        await updateNote(id, content);
      } else {
        const note = await createNote(content);
        noteIdRef.current = note.id;
        if (mountedRef.current) onCreated(note.id);
      }
      if (mountedRef.current) setSavedVersion(startVersion);
    } catch (err) {
      if (mountedRef.current) setError(errorMessage(err));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <>
      <TopBar>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
        <button type="button" onClick={save} disabled={!editor || !dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </TopBar>
      <main className="page-wrap">
        <EditorContent editor={editor} className="page" />
      </main>
    </>
  );
}
