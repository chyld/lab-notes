export type Query = {
  /** Lowercased words; each must appear in the note's text. */
  words: string[];
  /** Tag prefixes (a-z0-9); each must start one of the note's tags. */
  tagPrefixes: string[];
};

/** Splits on whitespace: `#tag` tokens are tag prefixes (a bare `#` is ignored), the rest words. */
export function parseQuery(q: string): Query {
  const query: Query = { words: [], tagPrefixes: [] };
  for (const token of q.split(/\s+/)) {
    if (!token) continue;
    if (token.startsWith("#")) {
      const prefix = token.slice(1).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (prefix) query.tagPrefixes.push(prefix);
    } else {
      query.words.push(token.normalize("NFC").toLowerCase());
    }
  }
  return query;
}

export const isEmptyQuery = (query: Query) => query.words.length === 0 && query.tagPrefixes.length === 0;

/**
 * Every token must match: words as case-insensitive substrings of the body (which starts with the
 * title line; the "Untitled" placeholder isn't text, so it never matches), tags by prefix.
 */
export function matchesQuery(note: { body: string; tags: string[] }, query: Query): boolean {
  // NFC on both sides: text pasted from macOS (NFD accents) still matches what's typed.
  const text = note.body.normalize("NFC").toLowerCase();
  return (
    query.words.every((word) => text.includes(word)) &&
    query.tagPrefixes.every((prefix) => note.tags.some((tag) => tag.startsWith(prefix)))
  );
}
