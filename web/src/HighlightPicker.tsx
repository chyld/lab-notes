import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { Ban, Highlighter } from "lucide-react";
import { HIGHLIGHTS } from "./highlights.ts";
import { keepFocus, useDismiss, usePopoverPlacement } from "./popover.ts";

const POPOVER_WIDTH = 252;

type Props = { editor: Editor; current: string | null };

export function HighlightPicker({ editor, current, disabled }: Props & { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="tool highlight-button"
        aria-label="Highlight color"
        title="Highlight color"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} // the editor keeps focus (and a phone's keyboard)
        onClick={() => {
          // Closing from the button: the popover's focused control goes away, so back to the text.
          if (open) editor.commands.focus();
          setOpen(!open);
        }}
      >
        <Highlighter size={18} aria-hidden />
        {/* backgroundColor, not background: a pasted color can't smuggle in a url(). */}
        <span className="highlight-bar" style={current ? { backgroundColor: current } : undefined} aria-hidden />
      </button>
      {open && buttonRef.current && (
        <HighlightPopover editor={editor} current={current} anchor={buttonRef.current} onClose={close} />
      )}
    </>
  );
}

type PopoverProps = Props & { anchor: HTMLElement; onClose: () => void };

function HighlightPopover({ editor, current, anchor, onClose }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const { sheet, style, touch } = usePopoverPlacement(anchor, POPOVER_WIDTH);
  const onBlur = useDismiss(popoverRef, anchor, onClose, { sheet, touch });
  // Focus starts on the current color, or the first.
  const focusIndex = Math.max(0, HIGHLIGHTS.findIndex((h) => h.color === current));

  function apply(color: string | null) {
    const chain = editor.chain().focus();
    (color ? chain.setHighlight({ color }) : chain.unsetHighlight()).run();
    onClose();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose();
    editor.commands.focus();
  }

  return createPortal(
    <div
      ref={popoverRef}
      className={sheet ? "highlight-popover popover-sheet" : "highlight-popover"}
      role="dialog"
      aria-label="Highlight colors"
      style={style}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onMouseDown={keepFocus}
    >
      <div className="highlight-swatches">
        {HIGHLIGHTS.map(({ name, color }, i) => (
          <button
            key={color}
            type="button"
            className="highlight-swatch"
            style={{ background: color }}
            aria-label={name}
            title={name}
            aria-pressed={color === current}
            autoFocus={!touch && i === focusIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(color)}
          />
        ))}
      </div>
      <button
        type="button"
        className="highlight-none"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => apply(null)}
      >
        <Ban size={16} aria-hidden />
        None
      </button>
    </div>,
    document.body,
  );
}
