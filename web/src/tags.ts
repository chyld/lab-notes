// The tag rule (the server validates it independently): lowercase letters and digits only.

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 50;

/** What a typed or pasted tag becomes: lowercased, everything but a-z and 0-9 dropped, cut to 40. */
export function normalizeTag(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, MAX_TAG_LENGTH);
}
