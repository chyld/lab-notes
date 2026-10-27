import { getSchema } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

// StarterKit defaults, except a plain click on a link places the cursor (so the toolbar can edit
// it) instead of opening it in a new tab.
export const extensions = [StarterKit.configure({ link: { openOnClick: false } })];

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
