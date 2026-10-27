// Regenerates web/src/google-fonts.json from Google Fonts' public metadata (no API key).
// Run with: npm run fonts:update
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Family = {
  family: string;
  category: string;
  popularity: number;
  isBrandFont?: boolean;
};

const res = await fetch("https://fonts.google.com/metadata/fonts");
if (!res.ok) throw new Error(`Google Fonts metadata request failed: ${res.status}`);
const raw = await res.text();
// The response may start with an anti-JSON-hijacking prefix such as ")]}'".
const { familyMetadataList } = JSON.parse(raw.slice(raw.indexOf("{"))) as { familyMetadataList: Family[] };

const catalog = familyMetadataList
  // Brand fonts (e.g. Google Sans) are listed but not served by the CSS API to everyone.
  .filter((f) => !f.isBrandFont && /^[A-Za-z0-9 ]+$/.test(f.family))
  .sort((a, b) => a.popularity - b.popularity || a.family.localeCompare(b.family))
  .map((f) => [f.family, f.category]);

const out = resolve(import.meta.dirname, "../web/src/google-fonts.json");
writeFileSync(out, JSON.stringify(catalog) + "\n");
console.log(`Wrote ${catalog.length} families to ${out}`);
