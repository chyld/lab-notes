import { getSchema, type ChainedCommands, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { catalogFamilies, loadFont, primaryFamily } from "./fonts.ts";

// StarterKit defaults, except a plain click on a link places the cursor (so the toolbar can edit
// it) instead of opening it in a new tab. TextStyle carries font family and size.
export const extensions = [
  StarterKit.configure({ link: { openOnClick: false } }),
  TextStyle,
  FontFamily,
  FontSize,
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
 * textStyle attributes at the start of the selection, or queued for typing at a cursor.
 * (editor.getAttributes() returns the first textStyle anywhere in a range, and at a cursor ignores
 * stored marks that were explicitly cleared.)
 */
export function textStyleAt(editor: Editor): Record<string, unknown> {
  const { state } = editor;
  const { selection } = state;
  const marks = selection.empty
    ? (state.storedMarks ?? selection.$from.marks())
    : (state.doc.nodeAt(selection.from)?.marks ?? selection.$from.marks());
  return marks.find((mark) => mark.type.name === "textStyle")?.attrs ?? {};
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
