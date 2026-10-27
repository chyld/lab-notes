// Google Fonts, linked from fonts.googleapis.com (the user chose linking over self-hosting).

export type FontCategory = "Sans Serif" | "Serif" | "Display" | "Handwriting" | "Monospace";
export type CatalogFont = [family: string, category: FontCategory];

export const CATEGORIES: FontCategory[] = ["Sans Serif", "Serif", "Display", "Handwriting", "Monospace"];

const GENERIC: Record<FontCategory, string> = {
  "Sans Serif": "sans-serif",
  Serif: "serif",
  Display: "sans-serif",
  Handwriting: "cursive",
  Monospace: "monospace",
};

// Every catalog name matches this; anything else is never put into a URL.
const SAFE_FAMILY = /^[A-Za-z0-9 ]+$/;

let catalog: Promise<CatalogFont[]> | null = null;
let families: Promise<Set<string>> | null = null;

/** The bundled catalog, imported on first use so it stays out of the main bundle. */
export function loadCatalog(): Promise<CatalogFont[]> {
  catalog ??= import("./google-fonts.json").then(
    (m) => m.default as CatalogFont[],
    (err: unknown) => {
      // Don't cache a failed chunk load (e.g. a stale deploy); the next call retries.
      catalog = null;
      families = null;
      throw err;
    },
  );
  return catalog;
}

/** Every Google Fonts family name, for telling them apart from fonts pasted in from elsewhere. */
export function catalogFamilies(): Promise<Set<string>> {
  families ??= loadCatalog().then((list) => new Set(list.map(([family]) => family)));
  return families;
}

/** The CSS value stored in the note: `"Family Name", generic`. */
export function fontStack(family: string, category: FontCategory): string {
  return `"${family}", ${GENERIC[category]}`;
}

/** The first family of a CSS font-family value, unquoted: `"Open Sans", sans-serif` → `Open Sans`. */
export function primaryFamily(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const first = stack.split(",")[0].trim().replace(/^["']|["']$/g, "");
  return first || null;
}

function cssUrl(family: string, query: string): string {
  return `https://fonts.googleapis.com/css2?family=${family.trim().replace(/ +/g, "+")}${query}`;
}

const linked = new Set<string>();

function link(key: string, href: string) {
  if (linked.has(key)) return;
  linked.add(key);
  const el = document.createElement("link");
  el.rel = "stylesheet";
  el.href = href;
  document.head.append(el);
}

/** Regular, bold, italic, and bold italic of a family (Google tolerates missing variants). */
export function loadFont(family: string) {
  if (!SAFE_FAMILY.test(family)) return;
  link(`font:${family}`, cssUrl(family, ":ital,wght@0,400;0,700;1,400;1,700&display=swap"));
}

/** Just the glyphs of the family's own name, for a picker row. */
export function loadPreview(family: string) {
  if (!SAFE_FAMILY.test(family) || linked.has(`font:${family}`)) return;
  link(`preview:${family}`, cssUrl(family, `&text=${encodeURIComponent(family)}&display=swap`));
}
