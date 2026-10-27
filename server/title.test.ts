import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTitle } from "./title.ts";

const text = (t: string) => ({ type: "text", text: t });
const p = (...content: object[]) => ({ type: "paragraph", content });
const doc = (...content: object[]) => ({ type: "doc", content });

test("first paragraph is the title", () => {
  assert.equal(extractTitle(doc(p(text("Groceries")), p(text("milk")))), "Groceries");
});

test("concatenates marked text runs", () => {
  const bold = { type: "text", text: "big", marks: [{ type: "bold" }] };
  assert.equal(extractTitle(doc(p(text("A "), bold, text(" plan")))), "A big plan");
});

test("heading counts as the first line", () => {
  assert.equal(extractTitle(doc({ type: "heading", attrs: { level: 1 }, content: [text("Title")] })), "Title");
});

test("stops at a hard break", () => {
  assert.equal(extractTitle(doc(p(text("line one"), { type: "hardBreak" }, text("line two")))), "line one");
});

test("stops at a newline inside a code block", () => {
  assert.equal(extractTitle(doc({ type: "codeBlock", content: [text("let a = 1;\nlet b = 2;"), text("x")] })), "let a = 1;");
});

test("descends into lists and blockquotes", () => {
  const list = { type: "bulletList", content: [{ type: "listItem", content: [p(text("first item"))] }] };
  assert.equal(extractTitle(doc(list)), "first item");
  assert.equal(extractTitle(doc({ type: "blockquote", content: [p(text("quoted"))] })), "quoted");
});

test("skips a leading horizontal rule", () => {
  assert.equal(extractTitle(doc({ type: "horizontalRule" }, p(text("after rule")))), "after rule");
});

test("blank first line is Untitled even if later lines have text", () => {
  assert.equal(extractTitle(doc({ type: "paragraph" }, p(text("second")))), "Untitled");
  assert.equal(extractTitle(doc(p(text("   ")), p(text("second")))), "Untitled");
});

test("collapses whitespace and trims, with no length cap", () => {
  assert.equal(extractTitle(doc(p(text("  a \t  b  ")))), "a b");
  const long = "x".repeat(500);
  assert.equal(extractTitle(doc(p(text(long)))), long);
});

test("empty documents are Untitled", () => {
  assert.equal(extractTitle(doc()), "Untitled");
  assert.equal(extractTitle({ type: "doc" }), "Untitled");
});

test("never throws on malformed input", () => {
  for (const bad of [null, undefined, 42, "doc", [], { content: "x" }, doc(null as never, p(text("ok")))]) {
    assert.doesNotThrow(() => extractTitle(bad));
  }
  assert.equal(extractTitle(doc(null as never, p(text("ok")))), "ok");
  assert.equal(extractTitle(doc({ type: "paragraph", content: "x" })), "Untitled");
  assert.equal(extractTitle(doc(p({ type: "text", text: 123 }, text("fine")))), "fine");
});

test("handles very deep and very wide input without overflowing the stack", () => {
  let node: object = p(text("bottom"));
  for (let i = 0; i < 100_000; i++) node = { type: "blockquote", content: [node] };
  assert.equal(extractTitle(doc(node)), "bottom");

  const wide = Array.from({ length: 300_000 }, () => ({ type: "horizontalRule" }));
  assert.equal(extractTitle(doc({ type: "blockquote", content: [...wide, p(text("after"))] })), "after");
});
