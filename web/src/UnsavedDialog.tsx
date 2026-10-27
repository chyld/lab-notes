import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** The note's title, as in the top bar. */
  title: string;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

/**
 * "You have unsaved changes" before leaving a note: Save (then go), Don't save (go), or Keep
 * editing (stay). A modal <dialog> in a portal: it traps focus, starts on Keep editing (so a
 * stray Enter stays), and Esc means Keep editing.
 */
export function UnsavedDialog({ title, saving, onSave, onDiscard, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    keepEditingRef.current?.focus(); // explicitly: browsers differ on a modal's first focus
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      className="unsaved-dialog"
      aria-labelledby="unsaved-title"
      aria-describedby="unsaved-text"
      onCancel={(event) => {
        event.preventDefault(); // Esc: we close it by staying (not while a save is running)
        if (!saving) onCancel();
      }}
    >
      <h2 id="unsaved-title">Unsaved changes</h2>
      <p id="unsaved-text">
        “{title}” has changes you haven't saved. Save them before you go?
      </p>
      <div className="unsaved-actions">
        {/* While a save runs, nothing else can be chosen: its outcome decides. */}
        <button type="button" className="button-quiet" ref={keepEditingRef} onClick={onCancel} disabled={saving}>
          Keep editing
        </button>
        <button type="button" className="button-danger" onClick={onDiscard} disabled={saving}>
          Don't save
        </button>
        <button type="button" className="button-primary" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
