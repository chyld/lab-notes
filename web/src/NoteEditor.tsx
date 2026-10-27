import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { createNote, errorMessage, updateNote, type Note } from "./api.ts";
import { extensions, loadDocumentFonts } from "./editor.ts";
import { LineNumbers, useLineNumbersSetting } from "./LineNumbers.tsx";
import { Toolbar } from "./Toolbar.tsx";
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
  // Set synchronously, unlike `saving`, so two clicks in one tick can't both save (and both POST).
  const savingRef = useRef(false);
  const noteIdRef = useRef(initialNote?.id ?? null);
  const mountedRef = useRef(false);
  const [lineNumbers, toggleLineNumbers] = useLineNumbersSetting();

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
    // No browser spell check (red squiggles) in notes (user request).
    editorProps: { attributes: { spellcheck: "false" } },
    onCreate: ({ editor }) => loadDocumentFonts(editor),
    onUpdate: ({ editor }) => {
      versionRef.current += 1;
      setVersion(versionRef.current);
      loadDocumentFonts(editor);
    },
  });

  const dirty = version !== savedVersion;

  async function save() {
    if (!editor || savingRef.current) return;
    savingRef.current = true;
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
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <div className="editor-screen">
      <div className="editor-header">
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
        {editor && <Toolbar editor={editor} lineNumbers={lineNumbers} onToggleLineNumbers={toggleLineNumbers} />}
      </div>
      <main className={lineNumbers ? "page-wrap with-line-numbers" : "page-wrap"}>
        <EditorContent editor={editor} className="page" />
        {editor && lineNumbers && <LineNumbers editor={editor} />}
      </main>
    </div>
  );
}
