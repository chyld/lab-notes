/**
 * Highlighter colors, in rainbow order. Hues ~45° apart; one OKLCH chroma (0.10, Yellow 0.15) and
 * each as light as sRGB allows, so #1f1f1f text keeps ≥ 9:1 contrast on every one. See SPEC.md.
 */
export const HIGHLIGHTS = [
  { name: "Red", color: "#ffaba3" },
  { name: "Orange", color: "#ffc18a" },
  { name: "Yellow", color: "#ffe967" },
  { name: "Green", color: "#bbf7bc" },
  { name: "Cyan", color: "#88f3ff" },
  { name: "Blue", color: "#90c4ff" },
  { name: "Purple", color: "#d9baff" },
  { name: "Pink", color: "#ffb2d6" },
] as const;

/** What a highlight with no color (Ctrl+Shift+H, ==text==) shows as; styles.css matches it. */
export const DEFAULT_HIGHLIGHT = "#ffe967";
