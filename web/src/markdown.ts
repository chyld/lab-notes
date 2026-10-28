// A note ⇄ Markdown text, for the Markdown source view (see SPEC "Markdown source").
//
// The dialect is Markdown for formatting, but one line per paragraph, as in the editor (Enter
// starts a new paragraph with no gap; an empty paragraph is an empty line). What Markdown can't say
// (underline, highlight colors, fonts and sizes, image sizes) is written as a few HTML tags, and
// only those tags are read back. No DOM or React here: the tests run it in Node.
import { Lexer, Tokenizer, type Token, type Tokens } from "marked";
import type { JSONContent } from "@tiptap/core";

type Mark = { type: string; attrs?: Record<string, unknown> };

// ── Shared ────────────────────────────────────────────────────────────────────────────────────

/** Marks open and close in this order (outermost first); code is always innermost. */
const MARK_ORDER = ["link", "textStyle", "highlight", "underline", "bold", "italic", "strike", "code"];

const rank = (mark: Mark) => {
  const index = MARK_ORDER.indexOf(mark.type);
  return index < 0 ? MARK_ORDER.length : index;
};

/** What makes two marks the same, as far as the text can say. */
function markKey(mark: Mark): string {
  const attrs = mark.attrs ?? {};
  switch (mark.type) {
    case "link":
      return `link:${attrs.href ?? ""}`;
    case "highlight":
      return `highlight:${attrs.color ?? ""}`;
    case "textStyle":
      return `textStyle:${attrs.fontFamily ?? ""}|${attrs.fontSize ?? ""}`;
    default:
      return mark.type;
  }
}

/** The marks the text can carry, in order (empty textStyles dropped). */
function textMarks(marks: Mark[] | undefined): Mark[] {
  return (marks ?? [])
    .filter((mark) => MARK_ORDER.includes(mark.type))
    .filter((mark) => mark.type !== "textStyle" || mark.attrs?.fontFamily || mark.attrs?.fontSize)
    .sort((a, b) => rank(a) - rank(b));
}

const sameMarks = (a: Mark[], b: Mark[]) =>
  a.length === b.length && a.every((mark, i) => markKey(mark) === markKey(b[i]));

/** Inline content in a canonical form: adjacent text with the same marks merged, empties dropped. */
function canonicalInline(nodes: JSONContent[] | undefined): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "text") {
      if (!node.text) continue;
      const marks = textMarks(node.marks as Mark[]);
      const last = out[out.length - 1];
      if (last?.type === "text" && sameMarks(last.marks as Mark[], marks)) {
        last.text += node.text;
      } else {
        out.push({ type: "text", text: node.text, marks });
      }
    } else {
      out.push({ type: node.type });
    }
  }
  return out;
}

const sameInline = (a: JSONContent[] | undefined, b: JSONContent[] | undefined) => {
  const x = canonicalInline(a);
  const y = canonicalInline(b);
  return (
    x.length === y.length &&
    x.every((node, i) => node.type === y[i].type && node.text === y[i].text && sameMarks((node.marks ?? []) as Mark[], (y[i].marks ?? []) as Mark[]))
  );
};

// URLs a link or image may point to: anything else stays text.
const SAFE_HREF = /^(?:https?:|mailto:|tel:|#|\/(?!\/))/i;
const SAFE_SRC = /^(?:https?:|\/(?!\/))/i;
// Attribute values that can only be the formatting itself (a `;` would smuggle in more CSS).
const SAFE_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const SAFE_FONT_FAMILY = /^[A-Za-z0-9 ,"'-]+$/;
const SAFE_FONT_SIZE = /^\d+(?:\.\d+)?(?:pt|px|em|rem|%)$/;

/**
 * A link or image destination: as is, or in `<…>` when it holds spaces or parentheses (which
 * would end the `(…)` early). Either way it reads back as exactly the same URL.
 */
const destination = (url: string) =>
  /[\s()<>]/.test(url) ? `<${url.replace(/</g, "%3C").replace(/>/g, "%3E")}>` : url;

// ── Writing ───────────────────────────────────────────────────────────────────────────────────

/** An `&` that would read back as an entity. */
const ENTITY_LIKE = /&(?=(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi;

/** Text that reads back as itself: Markdown punctuation escaped, entities and newlines guarded. */
function escapeText(text: string): string {
  return text
    .replace(ENTITY_LIKE, "&amp;")
    .replace(/[\\`*_[\]<>~]/g, (char) => `\\${char}`)
    .replace(/\n/g, "&#10;");
}

/** A line start that would read as a block construct gets escaped. */
function escapeLineStart(line: string): string {
  if (/^[ \t]/.test(line)) return (line[0] === "\t" ? "&#9;" : "&#32;") + line.slice(1);
  if (/^#/.test(line) || /^[-+](?:[ \t]|$)/.test(line) || /^-{3,}[ \t]*$/.test(line)) return `\\${line}`;
  const ordered = /^(\d+)([.)])(?:[ \t]|$)/.exec(line);
  if (ordered) return `${ordered[1]}\\${line.slice(ordered[1].length)}`;
  return line;
}

/** An attribute: double quotes with entities, or single quotes for a value with `"` but no `'`. */
function attr(name: string, value: string): string {
  const lines = (text: string) => text.replace(/\n/g, "&#10;"); // a newline would split the line
  if (value.includes('"') && !value.includes("'")) return ` ${name}='${lines(value.replace(/&/g, "&amp;"))}'`;
  const escaped = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return ` ${name}="${lines(escaped)}"`;
}

/** A code span whose backtick run is longer than any inside, padded where the code needs it. */
function codeSpan(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = /^[` ]|[` ]$/.test(code) && code.trim() !== "" ? " " : "";
  return `${fence}${pad}${code}${pad}${fence}`;
}

type Mode = "markdown" | "html";

function openMark(mark: Mark, mode: Mode): string {
  const attrs = mark.attrs ?? {};
  switch (mark.type) {
    case "link":
      return mode === "markdown" ? "[" : `<a${attr("href", String(attrs.href ?? ""))}>`;
    case "textStyle": {
      const style = [
        attrs.fontFamily ? `font-family: ${attrs.fontFamily}` : "",
        attrs.fontSize ? `font-size: ${attrs.fontSize}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      return `<span${attr("style", style)}>`;
    }
    case "highlight":
      return attrs.color ? `<mark${attr("data-color", String(attrs.color))}>` : "<mark>";
    case "underline":
      return "<u>";
    case "bold":
      return mode === "markdown" ? "**" : "<strong>";
    case "italic":
      return mode === "markdown" ? "*" : "<em>";
    case "strike":
      return mode === "markdown" ? "~~" : "<s>";
    default:
      return "";
  }
}

function closeMark(mark: Mark, mode: Mode): string {
  switch (mark.type) {
    case "link":
      return mode === "markdown" ? `](${destination(String(mark.attrs?.href ?? ""))})` : "</a>";
    case "textStyle":
      return "</span>";
    case "highlight":
      return "</mark>";
    case "underline":
      return "</u>";
    case "bold":
      return mode === "markdown" ? "**" : "</strong>";
    case "italic":
      return mode === "markdown" ? "*" : "</em>";
    case "strike":
      return mode === "markdown" ? "~~" : "</s>";
    default:
      return "";
  }
}

/**
 * Inline content as text. Marks that continue across neighboring pieces stay open; code is
 * written per piece (a span can't hold other markup).
 */
function writeInline(nodes: JSONContent[] | undefined, mode: Mode): string {
  let out = "";
  const open: Mark[] = [];
  const closeTo = (depth: number) => {
    while (open.length > depth) out += closeMark(open.pop()!, mode);
  };
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") {
      closeTo(0);
      out += "<br>";
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const marks = textMarks(node.marks as Mark[]);
    const code = marks.some((mark) => mark.type === "code");
    const outer = marks.filter((mark) => mark.type !== "code");
    let keep = 0;
    while (keep < open.length && keep < outer.length && markKey(open[keep]) === markKey(outer[keep])) keep++;
    closeTo(keep);
    for (const mark of outer.slice(keep)) {
      out += openMark(mark, mode);
      open.push(mark);
    }
    if (!code) {
      out += escapeText(node.text);
    } else if (mode === "markdown") {
      out += codeSpan(node.text);
    } else {
      // Read back literally (see readInline), so only what HTML itself needs is escaped.
      const literal = node.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#10;");
      out += `<code>${literal}</code>`;
    }
  }
  closeTo(0);
  return out;
}

/**
 * A line's inline content, as Markdown when that reads back exactly, otherwise with HTML tags
 * (which always do): odd cases cost readability on that one line, never content.
 */
function inlineLine(nodes: JSONContent[] | undefined, lineStart: boolean): string {
  const prefix = (text: string) => (lineStart ? escapeLineStart(text) : text);
  const markdown = prefix(writeInline(nodes, "markdown"));
  if (sameInline(readInline(markdown), nodes)) return markdown;
  return prefix(writeInline(nodes, "html"));
}

/** The lines of a list of blocks. `previous` tells adjacent lists and quotes apart. */
function writeBlocks(nodes: JSONContent[] | undefined): string[] {
  const lines: string[] = [];
  let previous: string | null = null;
  let alternate = false;
  for (const node of nodes ?? []) {
    const sameAsPrevious = node.type === previous;
    alternate = sameAsPrevious ? !alternate : false;
    lines.push(...writeBlock(node, sameAsPrevious, alternate));
    previous = node.type ?? null;
  }
  return lines;
}

const indent = (lines: string[], width: number) => lines.map((line) => " ".repeat(width) + line);

function writeBlock(node: JSONContent, afterSameType: boolean, alternate: boolean): string[] {
  switch (node.type) {
    case "paragraph":
      return [node.content?.length ? inlineLine(node.content, true) : ""];
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return [`${"#".repeat(level)} ${inlineLine(node.content, false)}`];
    }
    case "codeBlock": {
      const code = (node.content ?? []).map((child) => child.text ?? "").join("");
      const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      return [`${fence}${node.attrs?.language ?? ""}`, ...code.split("\n"), fence];
    }
    case "blockquote": {
      const inner = writeBlocks(node.content).map((line) => (line === "" ? ">" : `> ${line}`));
      return afterSameType ? ["<!---->", ...inner] : inner;
    }
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      const start = Number(node.attrs?.start ?? 1);
      const lines: string[] = [];
      (node.content ?? []).forEach((item, i) => {
        const marker = ordered ? `${start + i}${alternate ? ")" : "."} ` : alternate ? "* " : "- ";
        const [first, ...rest] = item.content ?? [];
        const firstLine = first?.type === "paragraph" && first.content?.length ? inlineLine(first.content, false) : "";
        lines.push(marker + firstLine);
        const children = first?.type === "paragraph" ? rest : (item.content ?? []);
        lines.push(...indent(writeBlocks(children), marker.length));
      });
      return lines;
    }
    case "horizontalRule":
      return ["---"];
    case "image": {
      const { src = "", alt, title, width, height } = (node.attrs ?? {}) as Record<string, unknown>;
      if (!width && !height && !title) {
        // Markdown when it reads back as this same image (alt text with a newline, say, wouldn't).
        const altText = String(alt ?? "").replace(/[\\[\]]/g, (char) => `\\${char}`);
        const line = `![${altText}](${destination(String(src))})`;
        const back = line.includes("\n") ? null : imageLine(line);
        if (back?.attrs && back.attrs.src === src && (back.attrs.alt ?? null) === (alt || null)) return [line];
      }
      let tag = `<img${attr("src", String(src))}`;
      if (alt) tag += attr("alt", String(alt));
      if (title) tag += attr("title", String(title));
      if (width) tag += attr("width", String(width));
      if (height) tag += attr("height", String(height));
      return [`${tag}>`];
    }
    default:
      // Not something the editor makes today: keep its text as a paragraph.
      return [inlineLine([{ type: "text", text: collectText(node) }], true)];
  }
}

function collectText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(collectText).join("");
}

/** The note as Markdown text. */
export function docToMarkdown(doc: JSONContent): string {
  return writeBlocks(doc.content).join("\n");
}

// ── Reading ───────────────────────────────────────────────────────────────────────────────────

// GFM for ~~strike~~, but no bare-URL autolinks: a plain URL in a note isn't a link. Local to this
// module (marked.use would change marked everywhere).
const tokenizer = new Tokenizer();
tokenizer.url = () => undefined;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"' };

/** marked leaves named entities in text as typed (it decodes numeric ones itself). */
const decodeNamed = (text: string) =>
  text.replace(/&(amp|lt|gt|quot);/g, (_, name: string) => NAMED_ENTITIES[name]);

/** Attribute values and literal code: every entity we write, decoded once. */
const decodeAll = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/gi, (whole, name: string) => {
    if (name[0] !== "#") return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

const TAGS = new Set(["u", "mark", "span", "strong", "b", "em", "i", "s", "del", "code", "a", "br", "img"]);
const TAG = /^<(\/?)([a-z]+)((?:\s+[a-z-]+=(?:"[^"]*"|'[^']*'))*)\s*\/?>$/;

type Tag = { closing: boolean; name: string; attrs: Record<string, string> };

/** One of the tags we write, exactly; anything else (comments, `</div>`, uppercase) is null. */
function parseTag(raw: string): Tag | null {
  const match = TAG.exec(raw);
  if (!match || !TAGS.has(match[2])) return null;
  const closing = match[1] === "/";
  if (closing && match[3].trim()) return null;
  const attrs: Record<string, string> = {};
  for (const [, name, double, single] of match[3].matchAll(/([a-z-]+)=(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[name] = decodeAll(double ?? single ?? "");
  }
  return { closing, name: match[2], attrs };
}

/** The mark an opening tag stands for (null: a tag that's fine but adds nothing). */
function tagMark(tag: Tag): Mark | null {
  switch (tag.name) {
    case "u":
      return { type: "underline" };
    case "strong":
    case "b":
      return { type: "bold" };
    case "em":
    case "i":
      return { type: "italic" };
    case "s":
    case "del":
      return { type: "strike" };
    case "code":
      return { type: "code" };
    case "mark": {
      const color = tag.attrs["data-color"];
      return { type: "highlight", attrs: { color: color && SAFE_COLOR.test(color) ? color : null } };
    }
    case "a":
      return tag.attrs.href && SAFE_HREF.test(tag.attrs.href) ? { type: "link", attrs: { href: tag.attrs.href } } : null;
    case "span": {
      let fontFamily: string | null = null;
      let fontSize: string | null = null;
      for (const declaration of (tag.attrs.style ?? "").split(";")) {
        const colon = declaration.indexOf(":");
        if (colon < 0) continue;
        const property = declaration.slice(0, colon).trim().toLowerCase();
        const value = declaration.slice(colon + 1).trim();
        if (property === "font-family" && SAFE_FONT_FAMILY.test(value)) fontFamily = value;
        if (property === "font-size" && SAFE_FONT_SIZE.test(value)) fontSize = value;
      }
      return fontFamily || fontSize ? { type: "textStyle", attrs: { fontFamily, fontSize } } : null;
    }
    default:
      return null;
  }
}

/** A line's inline content, read back into text nodes with marks. */
function readInline(src: string): JSONContent[] {
  const out: JSONContent[] = [];
  // Open HTML tags, innermost last; a tag that adds no mark still holds its place for its </tag>.
  const html: { name: string; mark: Mark | null }[] = [];
  const inCode = () => html.some((entry) => entry.name === "code");

  const push = (text: string, marks: Mark[]) => {
    if (!text) return;
    const all = textMarks([...marks, ...html.flatMap((entry) => (entry.mark ? [entry.mark] : []))]);
    const unique = all.filter((mark, i) => all.findIndex((other) => other.type === mark.type) === i);
    out.push(unique.length ? { type: "text", text, marks: unique } : { type: "text", text });
  };

  const walk = (tokens: Token[], marks: Mark[]) => {
    for (const token of tokens) {
      // Inside <code>…</code> everything is literal: marked would read **a** or \* in there.
      if (inCode() && !(token.type === "html" && /^<\/code\s*>$/.test(token.raw))) {
        push(decodeAll(token.raw), marks);
        continue;
      }
      switch (token.type) {
        case "text":
          push(decodeNamed((token as Tokens.Text).text), marks);
          break;
        case "escape":
          push((token as Tokens.Escape).text, marks);
          break;
        case "strong":
          walk((token as Tokens.Strong).tokens, [...marks, { type: "bold" }]);
          break;
        case "em":
          walk((token as Tokens.Em).tokens, [...marks, { type: "italic" }]);
          break;
        case "del":
          walk((token as Tokens.Del).tokens, [...marks, { type: "strike" }]);
          break;
        case "codespan":
          push((token as Tokens.Codespan).text, [...marks, { type: "code" }]);
          break;
        case "link": {
          const link = token as Tokens.Link;
          const explicit = link.raw.startsWith("[") || link.raw.startsWith("<");
          if (explicit && SAFE_HREF.test(link.href)) walk(link.tokens, [...marks, { type: "link", attrs: { href: link.href } }]);
          else push(link.raw, marks); // a bare URL the tokenizer still linked, or an unsafe href
          break;
        }
        case "br":
          out.push({ type: "hardBreak" });
          break;
        case "html": {
          const tag = parseTag(token.raw.trim());
          if (!tag || tag.name === "img") {
            push(token.raw, marks); // unknown, or an image mid-line (images are blocks)
          } else if (tag.name === "br") {
            out.push({ type: "hardBreak" });
          } else if (tag.closing) {
            const index = html.map((entry) => entry.name).lastIndexOf(tag.name);
            if (index >= 0) html.splice(index, 1);
            else push(token.raw, marks);
          } else {
            html.push({ name: tag.name, mark: tagMark(tag) });
          }
          break;
        }
        default:
          push(token.raw, marks); // an image mid-line, or anything else: literal
      }
    }
  };

  walk(Lexer.lexInline(src, { gfm: true, tokenizer }), []);
  return canonicalInline(out).map((node) =>
    node.type === "text" && !(node.marks as Mark[]).length ? { type: "text", text: node.text } : node,
  );
}

const paragraph = (src: string): JSONContent => {
  const content = readInline(src);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

const BULLET = /^([-*+])(?: (.*))?$/;
const ORDERED = /^(\d{1,9})([.)])(?: (.*))?$/;
const FENCE = /^(`{3,})(.*)$/;

/** An image alone on its line, as `![alt](src)` or `<img …>`; null if it isn't one. */
function imageLine(line: string): JSONContent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("![") && !trimmed.startsWith("<img")) return null;
  const tokens = Lexer.lexInline(trimmed, { gfm: true, tokenizer });
  if (tokens.length !== 1) return null;
  const [token] = tokens;
  let attrs: Record<string, unknown> | null = null;
  if (token.type === "image") {
    const image = token as Tokens.Image;
    attrs = { src: image.href, alt: image.text || null };
  } else if (token.type === "html") {
    const tag = parseTag(token.raw.trim());
    if (tag?.name === "img" && !tag.closing) {
      const size = (value: string | undefined) => (value && /^\d+$/.test(value) ? Number(value) : null);
      attrs = {
        src: tag.attrs.src ?? "",
        alt: tag.attrs.alt || null,
        title: tag.attrs.title || null,
        width: size(tag.attrs.width),
        height: size(tag.attrs.height),
      };
    }
  }
  if (!attrs || !SAFE_SRC.test(String(attrs.src))) return null;
  return { type: "image", attrs };
}

/** Blocks from lines (the top level, or a quote's or item's lines with their prefix removed). */
function readBlocks(lines: string[]): JSONContent[] {
  const blocks: JSONContent[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line === "<!---->") {
      i++; // separates two quotes in a row; adds nothing
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(`^\`{${fence[1].length},}\\s*$`);
      const code: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) code.push(lines[i++]);
      i++; // the closing fence (or past the end)
      const text = code.join("\n");
      const language = fence[2].trim() || null;
      blocks.push({ type: "codeBlock", attrs: { language }, ...(text ? { content: [{ type: "text", text }] } : {}) });
      continue;
    }

    const heading = /^(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
    if (heading) {
      const content = readInline(heading[2] ?? "");
      blocks.push({ type: "heading", attrs: { level: heading[1].length }, ...(content.length ? { content } : {}) });
      i++;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) {
      blocks.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) inner.push(lines[i++].replace(/^> ?/, ""));
      const content = readBlocks(inner);
      blocks.push({ type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      const sameKind = (candidate: string) => {
        if (bullet) return BULLET.exec(candidate)?.[1] === bullet[1];
        return ORDERED.exec(candidate)?.[2] === ordered![2];
      };
      const items: JSONContent[] = [];
      while (i < lines.length && sameKind(lines[i])) {
        const match = (bullet ? BULLET : ORDERED).exec(lines[i])!;
        const marker = bullet ? `${match[1]} ` : `${match[1]}${match[2]} `;
        const width = marker.length;
        const first = match[bullet ? 2 : 3] ?? "";
        i++;
        // The item's lines: those indented by its marker's width (a fence's lines to its close).
        const own: string[] = [];
        const pad = " ".repeat(width);
        let fenceClose: RegExp | null = null;
        while (i < lines.length) {
          const next = lines[i];
          if (fenceClose) {
            const body = next.startsWith(pad) ? next.slice(width) : next.replace(/^ +/, "");
            own.push(body);
            i++;
            if (fenceClose.test(body)) fenceClose = null;
            continue;
          }
          if (!next.startsWith(pad)) break;
          const body = next.slice(width);
          own.push(body);
          i++;
          const opened = FENCE.exec(body);
          if (opened) fenceClose = new RegExp(`^\`{${opened[1].length},}\\s*$`);
        }
        items.push({ type: "listItem", content: [paragraph(first), ...readBlocks(own)] });
      }
      blocks.push(
        bullet
          ? { type: "bulletList", content: items }
          : { type: "orderedList", attrs: { start: Number(ordered![1]), type: null }, content: items },
      );
      continue;
    }

    const image = imageLine(line);
    if (image) {
      blocks.push(image);
      i++;
      continue;
    }

    blocks.push(paragraph(line));
    i++;
  }
  return blocks;
}

/** Markdown text as a note (always a valid document: at least one block). */
export function markdownToDoc(text: string): JSONContent {
  const content = readBlocks(text.replace(/\r\n?/g, "\n").split("\n"));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
