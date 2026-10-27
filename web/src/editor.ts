import { getSchema, type ChainedCommands, type Editor, type ResizableNodeView } from "@tiptap/react";
import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { catalogFamilies, loadFont, primaryFamily } from "./fonts.ts";
import { DEFAULT_HIGHLIGHT } from "./highlights.ts";
import { ImagePaste } from "./imagePaste.ts";

// Ctrl+Shift+H toggles Yellow: it removes a Yellow highlight (or a colorless one, which shows as
// Yellow) and otherwise sets an explicit Yellow. Tiptap's own colorless toggle would merge in the
// color of the highlight around the cursor, even one just removed with "None".
const YellowShortcutHighlight = Highlight.extend({
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-h": () => {
        const mark = markAt(this.editor, "highlight");
        const yellow = mark !== undefined && (mark.attrs.color || DEFAULT_HIGHLIGHT) === DEFAULT_HIGHLIGHT;
        return yellow
          ? this.editor.commands.unsetHighlight()
          : this.editor.commands.setHighlight({ color: DEFAULT_HIGHLIGHT });
      },
    };
  },
});

// Tiptap's resizable image view ignores width/height changes it didn't make itself, so undoing or
// redoing a resize would leave the old size on screen. Apply them on every update.
// It also follows a touch drag on a handle but never listens for the touch ending, so a resize by
// touch was never stored: end it the way `mouseup` does.
const ResizableImage = Image.extend({
  addNodeView() {
    const create = this.parent?.();
    if (!create) return null;
    return (props) => {
      const view = create(props) as ResizableNodeView;
      const internals = view as unknown as {
        handleMouseUp: () => void;
        handleTouchMove: (event: TouchEvent) => void;
        onCommit: (width: number, height: number) => void;
      };
      let stopListening = () => {};
      const onTouchStart = (event: TouchEvent) => {
        if (!(event.target instanceof Element) || !event.target.closest("[data-resize-handle]")) return;
        stopListening();
        const { element } = view;
        const start = { width: element.style.width, height: element.style.height, size: element.offsetWidth };
        const finger = event.changedTouches[0]?.identifier;
        stopListening = () => {
          document.removeEventListener("touchend", end);
          document.removeEventListener("touchcancel", end);
          document.removeEventListener("touchmove", internals.handleTouchMove); // the library leaves it
          stopListening = () => {};
        };
        const end = (event: TouchEvent) => {
          // Another finger lifting isn't the end of this drag.
          if (![...event.changedTouches].some((touch) => touch.identifier === finger)) return;
          stopListening();
          const cancelled = event.type === "touchcancel";
          if (cancelled) Object.assign(element.style, { width: start.width, height: start.height });
          // A tap that didn't resize (or a cancelled drag) ends the drag without storing a size.
          if (cancelled || element.offsetWidth === start.size) {
            const commit = internals.onCommit;
            internals.onCommit = () => {};
            internals.handleMouseUp();
            internals.onCommit = commit;
          } else {
            internals.handleMouseUp(); // stores the new size: one undo step
          }
        };
        document.addEventListener("touchend", end);
        document.addEventListener("touchcancel", end);
      };
      // Capture: before the handle's own listener, which stops the event there.
      view.dom.addEventListener("touchstart", onTouchStart, true);
      const destroy = view.destroy.bind(view);
      view.destroy = () => {
        view.dom.removeEventListener("touchstart", onTouchStart, true);
        stopListening(); // the image went away mid-drag
        destroy();
      };
      const update = view.update.bind(view);
      view.update = (node, decorations, innerDecorations) => {
        if (!update(node, decorations, innerDecorations)) return false;
        const { width, height } = node.attrs as { width: number | null; height: number | null };
        view.element.style.width = width ? `${width}px` : "";
        view.element.style.height = height ? `${height}px` : "";
        return true;
      };
      return view;
    };
  },
});

// StarterKit defaults, except a plain click on a link places the cursor (so the toolbar can edit
// it) instead of opening it in a new tab. TextStyle carries font family and size.
export const extensions = [
  StarterKit.configure({ link: { openOnClick: false } }),
  TextStyle,
  FontFamily,
  FontSize,
  YellowShortcutHighlight.configure({ multicolor: true }),
  ResizableImage.configure({
    resize: {
      enabled: true,
      directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
      minWidth: 32,
      minHeight: 32,
      alwaysPreserveAspectRatio: true,
    },
  }),
  ImagePaste,
];

const schema = getSchema(extensions);

/** The same check Tiptap's `enableContentCheck` runs: parse against the schema, then validate. */
export function isValidContent(content: unknown): boolean {
  try {
    schema.nodeFromJSON(content).check();
    return true;
  } catch {
    return false;
  }
}

/**
 * The mark of this type at the start of the selection (its first inline node, so Select All reads
 * the first text, not the first paragraph), or queued for typing at a cursor.
 * (editor.getAttributes() returns the first mark anywhere in a range, and at a cursor ignores
 * stored marks that were explicitly cleared.)
 */
export function markAt(editor: Editor, name: string): Mark | undefined {
  const { state } = editor;
  const { selection } = state;
  let marks: readonly Mark[];
  if (selection.empty) {
    marks = state.storedMarks ?? selection.$from.marks();
  } else {
    let first: PMNode | undefined;
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (first) return false;
      if (node.isInline) first = node;
      return !node.isInline;
    });
    marks = first?.marks ?? selection.$from.marks();
  }
  return marks.find((mark) => mark.type.name === name);
}

/** textStyle attributes (font family/size) at the selection; see markAt. */
export function textStyleAt(editor: Editor): Record<string, unknown> {
  return markAt(editor, "textStyle")?.attrs ?? {};
}

/**
 * Set textStyle attributes (font family/size) on the selection. At a cursor, Tiptap's setMark
 * merges in the attributes of the surrounding text even after Clear formatting emptied the stored
 * marks, which would bring a cleared font back; so there every attribute is set explicitly, from
 * textStyleAt() with the rest null. Ranges keep Tiptap's per-segment merge, so changing the size
 * of text in two fonts keeps both fonts.
 */
export function setTextStyle(editor: Editor, chain: ChainedCommands, attrs: Record<string, string | null>) {
  if (!editor.state.selection.empty) return chain.setMark("textStyle", attrs);
  const names = Object.keys(editor.schema.marks.textStyle.spec.attrs ?? {});
  const cleared = Object.fromEntries(names.map((name) => [name, null]));
  return chain.setMark("textStyle", { ...cleared, ...textStyleAt(editor), ...attrs });
}

/**
 * The note's title as the server will compute it (SPEC "Title rule"): the first textblock's text
 * up to a hard break or newline, whitespace collapsed, else "Untitled". Live, for the top bar.
 */
export function liveTitle(editor: Editor): string {
  let title = "";
  let found = false;
  editor.state.doc.descendants((node) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    found = true;
    let line = "";
    let ended = false;
    node.forEach((child) => {
      if (ended) return;
      if (child.type.name === "hardBreak") {
        ended = true;
      } else if (child.isText) {
        const text = child.text ?? "";
        const newline = text.indexOf("\n");
        line += newline === -1 ? text : text.slice(0, newline);
        ended = newline !== -1;
      }
    });
    title = line;
    return false;
  });
  return title.replace(/\s+/g, " ").trim() || "Untitled";
}

/**
 * Link every Google Font the document uses, so its text renders in that font. Only catalog
 * families are requested: fonts pasted in from elsewhere (e.g. "Arial") aren't Google Fonts.
 */
export function loadDocumentFonts(editor: Editor) {
  const used = new Set<string>();
  editor.state.doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name !== "textStyle") continue;
      const family = primaryFamily(mark.attrs.fontFamily as string | null);
      if (family) used.add(family);
    }
  });
  if (used.size === 0) return;
  catalogFamilies().then(
    (known) => {
      for (const family of used) if (known.has(family)) loadFont(family);
    },
    () => {}, // catalog unavailable: text falls back to the generic family
  );
}
