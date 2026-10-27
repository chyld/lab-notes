// The tag rule (the server validates it independently): lowercase letters and digits only.

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 50;

/** How many tag colors styles.css defines (`.tag-chip[data-hue="0"]` … `[data-hue="7"]`). */
const TAG_HUES = 8;

/** A tag's color, the same everywhere and every time: a small hash of its name picks one of 8. */
export function tagHue(tag: string): number {
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % TAG_HUES;
}

/** What a typed or pasted tag becomes: lowercased, everything but a-z and 0-9 dropped, cut to 40. */
export function normalizeTag(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, MAX_TAG_LENGTH);
}
