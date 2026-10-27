import { getSchema } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

export const extensions = [StarterKit];

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
