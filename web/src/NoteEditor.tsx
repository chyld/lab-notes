import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { createNote, errorMessage, updateNote, type Note } from "./api.ts";
import { extensions, liveTitle, loadDocumentFonts } from "./editor.ts";
import { LineNumbers, useLineNumbersSetting } from "./LineNumbers.tsx";
import { TagEditor } from "./TagEditor.tsx";
import { UnsavedDialog } from "./UnsavedDialog.tsx";
import { MAX_TAGS, normalizeTag } from "./tags.ts";
import { Toolbar } from "./Toolbar.tsx";
import { TopBar } from "./TopBar.tsx";

type Props = {
  initialNote: Note | null;
  onCreated: (id: string) => void;
  /** After every successful save, even if this editor has since unmounted (the save happened). */
  onSaved: () => void;
};

export function NoteEditor({ initialNote, onCreated, onSaved }: Props) {
  // Bumped on every document change; the note is dirty while it differs from savedVersion.
  const [version, setVersion] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  // The save in flight, set synchronously (unlike `saving`): a second Save in the same tick gets
  // the same promise instead of starting another (which could POST twice), and the leave dialog
  // can wait for it.
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const noteIdRef = useRef(initialNote?.id ?? null);
  const mountedRef = useRef(false);
  const [lineNumbers, toggleLineNumbers] = useLineNumbersSetting();
  // Tags are part of the note, saved with Save; the refs are what a save reads (always current).
  const [tags, setTags] = useState<string[]>(initialNote?.tags ?? []);
  const tagsRef = useRef(tags);
  // A tag typed but not yet added. It counts as unsaved and Save adds it, so it's never lost.
  const [tagDraft, setTagDraft] = useState("");
  const tagDraftRef = useRef("");

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

  const dirty = version !== savedVersion || tagDraft !== "";
  // The same, from refs: current even between a state update and the render it causes.
  const isDirtyNow = () => versionRef.current !== savedVersionRef.current || tagDraftRef.current !== "";

  // Leaving with unsaved changes asks first (UnsavedDialog). Navigating to this same note's URL
  // (the new note → /notes/<id> step after its first save) isn't leaving.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirtyNow() &&
      nextLocation.pathname !== currentLocation.pathname &&
      nextLocation.pathname !== `/notes/${noteIdRef.current}`,
  );

  // Answer a blocked navigation once: go on, or stay. The ref sees the latest blocker even inside
  // an async handler, and `settledRef` keeps a second answer (a double click, the auto-proceed
  // below racing the dialog's Save) from calling proceed/reset again, which react-router rejects.
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const settledRef = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked") settledRef.current = false;
  }, [blocker.state]);
  const settle = (go: boolean) => {
    const current = blockerRef.current;
    if (current.state !== "blocked" || settledRef.current) return;
    settledRef.current = true;
    if (go) current.proceed();
    else current.reset();
  };

  // A save that finishes while the dialog is open (e.g. a toolbar Save still in flight when the
  // user clicked away) leaves nothing unsaved: just go on.
  useEffect(() => {
    if (blocker.state === "blocked" && !dirty && !saving) settle(true);
  });

  async function saveThenLeave() {
    let ok = await save({ stay: false });
    // If a save was already running, it may not have had the latest changes: save those too.
    if (ok && isDirtyNow()) ok = await save({ stay: false });
    // Saved: go on. Failed: stay, with the error in the top bar.
    settle(ok);
  }

  // Reloading or closing the tab: the browser's own "Leave site?" prompt.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // The top bar's breadcrumb follows the first line as it's typed.
  const title = useEditorState({ editor, selector: ({ editor }) => (editor ? liveTitle(editor) : "") }) ?? "";

  // A tag change is an edit like any other: it bumps the same version counter, so Save lights up
  // and a change made during a save stays unsaved.
  function changeTags(next: string[]) {
    tagsRef.current = next;
    setTags(next);
    versionRef.current += 1;
    setVersion(versionRef.current);
  }

  function addTag(text: string) {
    const tag = normalizeTag(text);
    const current = tagsRef.current;
    if (tag && !current.includes(tag) && current.length < MAX_TAGS) changeTags([...current, tag]);
  }

  function changeTagDraft(draft: string) {
    tagDraftRef.current = draft;
    setTagDraft(draft);
  }

  /**
   * Saves the note; resolves to whether it worked. While a save is in flight, returns that one.
   * `stay` false (saving on the way out of the note) skips the new note → /notes/<id> URL change,
   * since the page is about to leave anyway.
   */
  function save(options: { stay?: boolean } = {}): Promise<boolean> {
    if (!editor) return Promise.resolve(false);
    if (inFlightRef.current) return inFlightRef.current;
    const promise = runSave(editor, options).finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = promise;
    return promise;
  }

  async function runSave(editor: Editor, { stay = true }: { stay?: boolean }): Promise<boolean> {
    // A typed-but-not-added tag is saved too.
    if (tagDraftRef.current) {
      addTag(tagDraftRef.current);
      changeTagDraft("");
    }
    const startVersion = versionRef.current;
    const content = editor.getJSON();
    const savedTags = tagsRef.current;
    setSaving(true);
    setError(null);
    try {
      const id = noteIdRef.current;
      if (id) {
        await updateNote(id, content, savedTags);
      } else {
        const note = await createNote(content, savedTags);
        noteIdRef.current = note.id;
        if (mountedRef.current && stay) onCreated(note.id);
      }
      onSaved();
      savedVersionRef.current = startVersion;
      if (mountedRef.current) setSavedVersion(startVersion);
      return true;
    } catch (err) {
      if (mountedRef.current) setError(errorMessage(err));
      return false;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <div className="editor-screen">
      <div className="editor-header">
        <TopBar title={title}>
          {error && (
            <span className="error" role="alert">
              {error}
            </span>
          )}
        </TopBar>
        {editor && (
          <Toolbar
            editor={editor}
            canSave={dirty && !saving}
            saving={saving}
            onSave={() => void save()}
            lineNumbers={lineNumbers}
            onToggleLineNumbers={toggleLineNumbers}
          />
        )}
      </div>
      <main className={lineNumbers ? "page-wrap with-line-numbers" : "page-wrap"}>
        <TagEditor
          tags={tags}
          draft={tagDraft}
          onDraftChange={changeTagDraft}
          onAdd={addTag}
          onRemove={(tag) => changeTags(tagsRef.current.filter((t) => t !== tag))}
        />
        <EditorContent editor={editor} className="page" />
        {editor && lineNumbers && <LineNumbers editor={editor} />}
      </main>
      {blocker.state === "blocked" && (
        <UnsavedDialog
          title={title}
          saving={saving}
          onCancel={() => {
            settle(false);
            editor?.commands.focus(); // back to typing where they were
          }}
          onDiscard={() => settle(true)}
          onSave={() => void saveThenLeave()}
        />
      )}
    </div>
  );
}
