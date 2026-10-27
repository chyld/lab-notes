import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Minus, Plus } from "lucide-react";
import { setTextStyle, textStyleAt } from "./editor.ts";
import { Tool } from "./ToolButton.tsx";

const MIN_PT = 1;
const MAX_PT = 400;

/** "18pt" → 18, "24px" → 18; relative units (em, %, …) → null, read from the DOM instead. */
function toPoints(size: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(pt|px)\s*$/i.exec(size);
  if (!match) return null;
  const n = Number(match[1]);
  return match[2].toLowerCase() === "px" ? Math.round(n * 0.75) : Math.round(n);
}

/**
 * The font size at the start of the selection, in points: the textStyle fontSize if set, otherwise
 * the computed size of the text there (so headings show their real size). Null until the editor's
 * DOM is laid out.
 */
export function sizeAtSelection(editor: Editor): number | null {
  const explicit = textStyleAt(editor).fontSize;
  if (typeof explicit === "string") {
    const points = toPoints(explicit);
    if (points !== null) return points;
  }
  try {
    const { state, view } = editor;
    const { selection } = state;
    // At a cursor, measure the text before it (what typing continues); for a range, its start.
    const side = selection.empty ? -1 : 1;
    const { node, offset } = view.domAtPos(selection.from, side);
    let target: Node | null = node;
    if (node.nodeType === Node.ELEMENT_NODE) {
      target = node.childNodes[side < 0 ? offset - 1 : offset] ?? node;
    }
    let el = target?.nodeType === Node.TEXT_NODE ? target.parentElement : (target as Element | null);
    // After Clear formatting the cursor may still sit in an old sized span, but typing won't use it:
    // measure the block instead.
    if (selection.empty && state.storedMarks !== null) {
      el = el?.closest("p, h1, h2, h3, h4, h5, h6, pre") ?? el;
    }
    if (!el) return null;
    const px = parseFloat(getComputedStyle(el).fontSize);
    return Number.isFinite(px) ? Math.round(px * 0.75) : null;
  } catch {
    return null;
  }
}

type Props = { editor: Editor; size: number | null; disabled: boolean };

export function FontSizeControl({ editor, size, disabled }: Props) {
  // What the user is typing; null shows the size at the selection. The ref is read on blur, which
  // can fire in the same tick as Enter/Escape, before the state update lands.
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);

  function setTyped(value: string | null) {
    draftRef.current = value;
    setDraft(value);
  }

  function apply(points: number, refocus: boolean) {
    const clamped = Math.min(MAX_PT, Math.max(MIN_PT, Math.round(points)));
    const chain = refocus ? editor.chain().focus() : editor.chain();
    setTextStyle(editor, chain, { fontSize: `${clamped}pt` }).run();
  }

  /** The typed size if it's a plain whole number, else null. Clears the draft either way. */
  function takeTyped(): number | null {
    const typed = draftRef.current?.trim() ?? null;
    setTyped(null);
    return typed !== null && /^\d+$/.test(typed) && Number(typed) > 0 ? Number(typed) : null;
  }

  function commit(refocus: boolean) {
    const typed = takeTyped();
    if (typed !== null) apply(typed, refocus);
  }

  // −/+ cancel mousedown, so the input doesn't blur first: step from a pending typed size.
  function step(delta: number, fromKeyboard: boolean) {
    apply((takeTyped() ?? size ?? 12) + delta, !fromKeyboard);
  }

  return (
    <div className="font-size">
      <Tool
        icon={Minus}
        label="Decrease font size"
        onClick={(fromKeyboard) => step(-1, fromKeyboard)}
        disabled={disabled || size === null || size <= MIN_PT}
      />
      <input
        className="font-size-input"
        aria-label="Font size"
        title="Font size"
        inputMode="numeric"
        disabled={disabled}
        value={draft ?? (size === null ? "" : String(size))}
        onChange={(event) => setTyped(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={() => commit(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(true);
            editor.commands.focus(); // also when nothing was typed
          } else if (event.key === "Escape") {
            event.preventDefault();
            setTyped(null);
            editor.commands.focus();
          }
        }}
      />
      <Tool
        icon={Plus}
        label="Increase font size"
        onClick={(fromKeyboard) => step(1, fromKeyboard)}
        disabled={disabled || size === null || size >= MAX_PT}
      />
    </div>
  );
}
