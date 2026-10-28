import { Extension, type Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import type { Fragment, NodeType, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { errorMessage, uploadImage } from "./api.ts";

/** Matches the server's limit (server/images.ts). */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** A paste waiting on its uploads: the range it will replace, and that range's content then. */
type Pending = { id: object; from: number; to: number; original: Fragment };
type Meta = { add: Pending } | { remove: object };

const key = new PluginKey<Pending[]>("imagePaste");

function placeholder() {
  const el = document.createElement("span");
  el.className = "image-uploading";
  el.textContent = "Uploading image…";
  return el;
}

/**
 * The position right after the node the last step inserted. (The step's range can be wider: mid-line
 * it also covers the split paragraph's edges.)
 */
function afterInserted(tr: Transaction, type: NodeType): number {
  let from = 0;
  let to = 0;
  tr.mapping.maps[tr.mapping.maps.length - 1].forEach((_from, _to, newFrom, newTo) => {
    from = newFrom;
    to = newTo;
  });
  let end = to;
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === type) end = pos + node.nodeSize;
    return !node.isTextblock;
  });
  return end;
}

/**
 * Take over the paste when it carries image files and no text: a screenshot, or a browser's "Copy
 * image" (whose HTML is just an <img>). Copying text with pictures (a web page, a word processor,
 * which also puts a PNG of the whole selection on the clipboard) pastes normally.
 */
function imageFiles(view: EditorView, event: ClipboardEvent, slice: Slice): File[] | null {
  const data = event.clipboardData;
  if (!data || view.state.selection.$from.parent.type.spec.code) return null;
  const files = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
  if (files.length === 0) return null;
  const hasText = slice.content.textBetween(0, slice.content.size, " ", " ").trim() !== "";
  if (data.getData("text/html") && hasText) return null;
  return files;
}

/**
 * One transaction: drop the placeholder and, if anything uploaded, put the images where the paste
 * was. The pasted-over selection is replaced only now, and only if it's unchanged, so a failed
 * upload or an edit made meanwhile never loses text.
 */
function insertUploaded(view: EditorView, id: object, results: PromiseSettledResult<string>[]) {
  if (view.isDestroyed) return; // the user left the note
  const urls = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failures = results.flatMap((r) => (r.status === "rejected" ? [errorMessage(r.reason)] : []));
  const { state } = view;
  const pending = key.getState(state)?.find((p) => p.id === id);
  const tr = state.tr.setMeta(key, { remove: id } satisfies Meta);
  const inserting = pending !== undefined && urls.length > 0;
  if (inserting) {
    const { from, to } = pending;
    const { image, paragraph } = state.schema.nodes;
    const replace = state.doc.slice(from, to).content.eq(pending.original);
    const cursorThere = state.selection.from === from && state.selection.to === to;
    let at = replace ? from : to;
    let end = to;
    for (const src of urls) {
      // Moves out of a paragraph's start/end and replaces an empty one, instead of leaving an empty
      // line; mid-line it splits the paragraph.
      tr.replaceRangeWith(at, end, image.create({ src }));
      at = end = afterInserted(tr, image);
    }
    if (cursorThere) {
      // Keep typing below the images, on a new line if nothing textual follows them.
      if (!tr.doc.resolve(at).nodeAfter?.isTextblock) tr.insert(at, paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView();
    }
  }
  if (!inserting) {
    view.dispatch(tr);
  } else {
    // Its own undo step: history would otherwise merge it with typing done just before or after.
    view.dispatch(closeHistory(tr));
    view.dispatch(closeHistory(view.state.tr));
  }
  if (failures.length > 0) {
    window.alert(`Couldn't upload ${failures.length === 1 ? "an image" : `${failures.length} images`}: ${failures[0]}`);
  }
}

function pastePending(state: EditorState): Pending[] {
  return key.getState(state) ?? [];
}

/** Images still uploading (they'll land in the document when they finish). */
export const uploadsPending = (editor: Editor) => pastePending(editor.state).length > 0;

/** Paste images: upload them, showing "Uploading image…" where they'll go, then insert them. */
export const ImagePaste = Extension.create({
  name: "imagePaste",

  addProseMirrorPlugins() {
    return [
      new Plugin<Pending[]>({
        key,
        state: {
          init: () => [],
          apply(tr, pending) {
            const meta = tr.getMeta(key) as Meta | undefined;
            let next = !tr.docChanged
              ? pending
              : pending.map((p) => {
                  // Text typed at either edge stays outside the range.
                  const from = tr.mapping.map(p.from, 1);
                  return { ...p, from, to: Math.max(from, tr.mapping.map(p.to, -1)) };
                });
            if (meta && "add" in meta) next = [...next, meta.add];
            if (meta && "remove" in meta) next = next.filter((p) => p.id !== meta.remove);
            return next;
          },
        },
        props: {
          decorations(state) {
            const pending = pastePending(state);
            if (pending.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              pending.map((p) => Decoration.widget(p.to, placeholder, { id: p.id })),
            );
          },
          handlePaste(view, event, slice) {
            const files = imageFiles(view, event, slice);
            if (!files) return false;
            const uploads = files.filter((file) => file.size <= MAX_IMAGE_BYTES);
            if (uploads.length < files.length) window.alert("Images can be up to 25 MB.");
            if (uploads.length === 0) return true;

            const { from, to } = view.state.selection;
            const pending: Pending = { id: {}, from, to, original: view.state.doc.slice(from, to).content };
            view.dispatch(view.state.tr.setMeta(key, { add: pending } satisfies Meta));
            void Promise.allSettled(uploads.map(uploadImage)).then((results) =>
              insertUploaded(view, pending.id, results),
            );
            return true;
          },
        },
      }),
    ];
  },
});
