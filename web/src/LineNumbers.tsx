import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";

const STORAGE_KEY = "lab-notes:line-numbers";

/** Whether line numbers show, remembered in this browser (not per note, not in the note). */
export function useLineNumbersSetting(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "on";
    } catch {
      return false; // storage unavailable: just not remembered
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      // not remembered
    }
  }, [on]);
  const toggle = useCallback(() => setOn((was) => !was), []);
  return [on, toggle];
}

type Line = { top: number; height: number };

/**
 * Every visual line of text, top to bottom, relative to `origin`: each textblock's client rects,
 * merged where they mostly overlap vertically (one line can hold several rects: mixed font sizes,
 * an inline element's box and its text). Blank lines (empty code lines, hard breaks) still have
 * zero-width rects, so only zero-height ones are dropped. A textblock with no rects at all counts
 * as one line.
 */
function measureLines(editor: Editor, origin: DOMRect): Line[] {
  const lines: Line[] = [];
  const range = document.createRange();
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return false;
    range.selectNodeContents(dom);
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.height > 0)
      .sort((a, b) => a.top - b.top);
    const block: { top: number; bottom: number }[] = [];
    for (const rect of rects) {
      const last = block[block.length - 1];
      // Same line if they overlap by over half the shorter one: a small rect inside a tall one
      // merges, while a box that bleeds a pixel or two into the next line doesn't chain them.
      const overlap = last ? Math.min(last.bottom, rect.bottom) - Math.max(last.top, rect.top) : 0;
      if (last && overlap > Math.min(last.bottom - last.top, rect.height) / 2) {
        last.bottom = Math.max(last.bottom, rect.bottom);
      } else {
        block.push({ top: rect.top, bottom: rect.bottom });
      }
    }
    if (block.length === 0) {
      const box = dom.getBoundingClientRect();
      const style = getComputedStyle(dom);
      block.push({ top: box.top + parseFloat(style.paddingTop), bottom: box.bottom - parseFloat(style.paddingBottom) });
    }
    for (const { top, bottom } of block) lines.push({ top: top - origin.top, height: bottom - top });
    return false;
  });
  return lines;
}

const sameLines = (a: Line[], b: Line[]) =>
  a.length === b.length && a.every((line, i) => line.top === b[i].top && line.height === b[i].height);

/** The gutter. Rendered inside the editor's `.page-wrap`, which positions it. */
export function LineNumbers({ editor }: { editor: Editor }) {
  const [lines, setLines] = useState<Line[]>([]);
  const gutterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const container = gutterRef.current?.parentElement;
      if (!container || editor.isDestroyed) return;
      const next = measureLines(editor, container.getBoundingClientRect());
      setLines((prev) => (sameLines(prev, next) ? prev : next));
    };
    // At most one measurement per frame, however many changes land in it.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();

    // Cursor moves don't move lines; edits and decoration changes (the upload placeholder) can.
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged || !transaction.selectionSet) schedule();
    };
    const dom = editor.view.dom;
    editor.on("transaction", onTransaction);
    // The editor resizing rewraps the text; anything else in the container resizing (the tag row
    // wrapping onto a new line) moves it.
    const resize = new ResizeObserver(schedule);
    resize.observe(dom);
    for (const sibling of gutterRef.current?.parentElement?.children ?? []) {
      if (sibling !== gutterRef.current) resize.observe(sibling);
    }
    document.fonts.addEventListener("loadingdone", schedule); // Google Fonts rewrap it too
    // An image loading (or failing, and showing as broken) moves the lines below it.
    dom.addEventListener("load", schedule, true);
    dom.addEventListener("error", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", onTransaction);
      resize.disconnect();
      document.fonts.removeEventListener("loadingdone", schedule);
      dom.removeEventListener("load", schedule, true);
      dom.removeEventListener("error", schedule, true);
    };
  }, [editor]);

  return (
    <div ref={gutterRef} className="line-numbers" aria-hidden>
      {lines.map((line, i) => (
        <span key={i} style={{ top: line.top, height: line.height }}>
          {i + 1}
        </span>
      ))}
    </div>
  );
}
