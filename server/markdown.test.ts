// The Markdown source view's converter (web/src/markdown.ts), checked in Node: it has no DOM or
// React in it. Documents are compared through the editor's own schema, the way the editor would
// see them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchema, type JSONContent } from "@tiptap/core";
import { docToMarkdown, markdownToDoc } from "../web/src/markdown.ts";

// Loaded through a variable so the server typecheck doesn't follow it into the web code (DOM).
const EDITOR = "../web/src/editor.ts";
const { extensions } = (await import(EDITOR)) as { extensions: Parameters<typeof getSchema>[0] };
const schema = getSchema(extensions);

/** As the editor would hold it: defaults filled in, and valid (check() throws otherwise). */
function normalize(doc: JSONContent) {
  const node = schema.nodeFromJSON(doc);
  node.check();
  return node.toJSON();
}

const t = (text: string, ...marks: Array<string | { type: string; attrs: Record<string, unknown> }>): JSONContent => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((mark) => (typeof mark === "string" ? { type: mark } : mark)) } : {}),
});
const p = (...content: JSONContent[]): JSONContent => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const h = (level: number, ...content: JSONContent[]): JSONContent => ({ type: "heading", attrs: { level }, content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const li = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const ul = (...items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });
const ol = (start: number, ...items: JSONContent[]): JSONContent => ({ type: "orderedList", attrs: { start }, content: items });
const quote = (...content: JSONContent[]): JSONContent => ({ type: "blockquote", content });
const code = (text: string, language: string | null = null): JSONContent => ({
  type: "codeBlock",
  attrs: { language },
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const link = (href: string) => ({ type: "link", attrs: { href } });
const highlight = (color: string | null) => ({ type: "highlight", attrs: { color } });
const style = (fontFamily: string | null, fontSize: string | null) => ({ type: "textStyle", attrs: { fontFamily, fontSize } });

/** Writes the doc, reads it back, and expects the same document (and returns the text). */
function roundTrip(input: JSONContent, message?: string): string {
  const text = docToMarkdown(input);
  assert.deepEqual(normalize(markdownToDoc(text)), normalize(input), `${message ?? ""}\n--- text ---\n${text}`);
  return text;
}

test("one line per paragraph; empty paragraphs are empty lines", () => {
  const text = roundTrip(doc(p(t("first")), p(t("second")), p(), p(t("after a gap")), p()));
  assert.equal(text, "first\nsecond\n\nafter a gap\n");
  assert.deepEqual(normalize(markdownToDoc("")), normalize(doc(p())));
  assert.deepEqual(normalize(markdownToDoc("a\r\nb")), normalize(doc(p(t("a")), p(t("b")))));
});

test("headings, rules, code blocks", () => {
  const text = roundTrip(
    doc(h(1, t("Title")), h(3, t("Sub")), { type: "horizontalRule" }, code("pvecm status\n\nceph -s", "bash"), code(""), p(t("end"))),
  );
  assert.match(text, /^# Title\n### Sub\n---\n```bash\npvecm status\n\nceph -s\n```\n```\n\n```\nend$/);
  // A fence longer than any backtick run inside.
  const fenced = roundTrip(doc(code("a ``` b\n````")));
  assert.ok(fenced.startsWith("`````\n"), fenced);
});

test("marks: Markdown where it reads back, HTML for what Markdown can't say", () => {
  const text = roundTrip(
    doc(
      p(t("plain "), t("bold", "bold"), t(" "), t("both", "bold", "italic"), t(" "), t("struck", "strike"), t(" "), t("x = 1", "code")),
      p(t("a "), t("link", link("https://example.com/a b")), t(" and "), t("under", "underline")),
      p(t("hi", highlight("#ffe967")), t(" "), t("plain hi", highlight(null)), t(" "), t("font", style('"Lobster", cursive', "18pt"))),
      p(t("size only", style(null, "9pt")), { type: "hardBreak" }, t("after a break")),
    ),
  );
  assert.match(text, /\*\*bold\*\* \*\*\*both\*\*\* ~~struck~~ `x = 1`/);
  assert.match(text, /\[link\]\(<https:\/\/example\.com\/a b>\) and <u>under<\/u>/);
  assert.match(text, /<mark data-color="#ffe967">hi<\/mark> <mark>plain hi<\/mark> <span style='font-family: "Lobster", cursive; font-size: 18pt'>font<\/span>/);
  assert.match(text, /<br>after a break/);
});

test("marks continuing across pieces stay open", () => {
  const text = roundTrip(doc(p(t("bold ", "bold"), t("and italic", "bold", "italic"))));
  assert.equal(text, "**bold *and italic***");
});

test("a line that wouldn't read back is written with HTML instead", () => {
  const text = roundTrip(doc(p(t("hello ", "bold"), t("world"))));
  assert.equal(text, "<strong>hello </strong>world");
  roundTrip(doc(p(t("a"), t('"quoted"', "bold"), t("b"))));
  roundTrip(doc(p(t("**not bold** `x`", "code"), t(" after"))));
});

test("escaping: text full of Markdown punctuation reads back as itself", () => {
  const nasty = "*a* _b_ `c` [d](e) <u>f</u> ~~g~~ \\ & &amp; &#10; &copy; ![x](y) <!-- c -->";
  roundTrip(doc(p(t(nasty))));
  for (const start of ["# not a heading", "- not a list", "+ nope", "1. not numbered", "2) nor this", "---", "> not a quote", "```", "<!---->", "![a](/b)", "#", "-"]) {
    roundTrip(doc(p(t(start))), start);
  }
  roundTrip(doc(p(t("tabs\tand  spaces"))));
});

test("leading whitespace and newlines inside text survive", () => {
  roundTrip(doc(ul(li(p(t("item")))), p(t("  indented, after a list"))));
  roundTrip(doc(p(t("\tstarts with a tab"))));
  roundTrip(doc(p(t("pasted\ntwo lines"))), "a newline inside a text node");
  roundTrip(doc(p(t("code\nwith newline", "code"))), "a newline inside code");
});

test("lists: nesting, numbering, continuation, empty paragraphs", () => {
  const text = roundTrip(
    doc(
      ul(li(p(t("one")), p(t("more of one")), ul(li(p(t("nested"))))), li(p(t("two")))),
      ol(9, li(p(t("nine"))), li(p(t("ten")), p(t("ten's second")), ol(1, li(p(t("deep")))))),
      p(t("after")),
    ),
  );
  assert.match(text, /^- one\n  more of one\n  - nested\n- two\n9\. nine\n10\. ten\n    ten's second\n    1\. deep\nafter$/);
  roundTrip(doc(ul(li(p(t("a")), p(), p(t("b")))), p()), "an empty paragraph inside an item");
  roundTrip(doc(ul(li(p()))), "an empty item");
  roundTrip(doc(ul(li(p(t("x")), code("line 1\n\nline 3")))), "an empty code line inside an item");
});

test("adjacent lists and quotes stay separate", () => {
  const lists = roundTrip(doc(ul(li(p(t("a")))), ul(li(p(t("b")))), ol(1, li(p(t("c")))), ol(1, li(p(t("d"))))));
  assert.equal(lists, "- a\n* b\n1. c\n1) d");
  const quotes = roundTrip(doc(quote(p(t("a")), p(t("b"))), quote(p(t("c")))));
  assert.equal(quotes, "> a\n> b\n<!---->\n> c");
});

test("quotes and items hold any block", () => {
  roundTrip(
    doc(
      quote(h(2, t("In a quote")), ul(li(p(t("listed")))), code("x = 1"), quote(p(t("deeper"))), p(), p(t("last"))),
      ul(li(p(t("item")), quote(p(t("quoted in item"))), h(4, t("heading in item")), { type: "horizontalRule" })),
    ),
  );
});

test("images: Markdown or <img> with a size; only alone on a line", () => {
  const plain = { type: "image", attrs: { src: "/api/images/abc", alt: "a [cat]" } };
  const sized = { type: "image", attrs: { src: "/api/images/def", alt: null, width: 320, height: 200 } };
  const text = roundTrip(doc(p(t("before")), plain, sized, p(t("after"))));
  assert.match(text, /!\[a \\\[cat\\\]\]\(\/api\/images\/abc\)\n<img src="\/api\/images\/def" width="320" height="200">/);
  roundTrip(doc(ul(li(p(t("x")), plain))), "an image in an item");
  // Alt text Markdown can't hold exactly falls back to <img>.
  for (const alt of ["two\nlines", 'quotes " and \' both', "back\\slash [x] *y*", "&amp; &copy;"]) {
    roundTrip(doc({ type: "image", attrs: { src: "/api/images/x", alt } }), JSON.stringify(alt));
  }
  // Mid-line, an image is literal text.
  assert.deepEqual(normalize(markdownToDoc("see ![x](/api/images/a) here")), normalize(doc(p(t("see ![x](/api/images/a) here")))));
});

test("unsafe or unknown things stay text", () => {
  const read = (text: string) => normalize(markdownToDoc(text));
  assert.deepEqual(read("[x](javascript:alert(1))"), normalize(doc(p(t("[x](javascript:alert(1))")))));
  assert.deepEqual(read('<a href="javascript:alert(1)">x</a>'), normalize(doc(p(t("x")))));
  assert.deepEqual(read("![x](javascript:alert(1))"), normalize(doc(p(t("![x](javascript:alert(1))")))));
  assert.deepEqual(read('<img src="javascript:x">'), normalize(doc(p(t('<img src="javascript:x">')))));
  assert.deepEqual(read("<script>alert(1)</script>"), normalize(doc(p(t("<script>alert(1)</script>")))));
  assert.deepEqual(read("<div>x</div> <U>y</U> <!-- c -->"), normalize(doc(p(t("<div>x</div> <U>y</U> <!-- c -->")))));
  // Values that aren't just formatting are ignored (the text stays, unformatted).
  assert.deepEqual(read('<span style="font-family: x; background: url(http://evil)">a</span>'), normalize(doc(p(t("a", style("x", null))))));
  assert.deepEqual(read('<span style="font-size: 1px url(x)">a</span>'), normalize(doc(p(t("a")))));
  assert.deepEqual(read('<mark data-color="red;x">a</mark>'), normalize(doc(p(t("a", highlight(null))))));
  // A bare URL or email isn't a link; an explicit one is.
  assert.deepEqual(read("see https://example.com or a@b.com"), normalize(doc(p(t("see https://example.com or a@b.com")))));
  assert.deepEqual(read("see <https://example.com>"), normalize(doc(p(t("see "), t("https://example.com", link("https://example.com"))))));
});

test("entities: the ones written are read back; others stay as typed", () => {
  const read = (text: string) => normalize(markdownToDoc(text));
  assert.deepEqual(read("a &amp; b &lt;c&gt; &quot;d&quot; &#38; &copy;"), normalize(doc(p(t('a & b <c> "d" & &copy;')))));
  roundTrip(doc(p(t("&amp; and &#10; and &lt; typed literally"))));
  roundTrip(doc(p(t("x", style("\"Open Sans\", 'Fallback', sans-serif", null)))), "a font stack with both quotes");
});
