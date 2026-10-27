const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

type Node = { type?: unknown; text?: unknown; content?: unknown };

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null;
}

function children(node: Node): unknown[] {
  return Array.isArray(node.content) ? node.content : [];
}

// Depth-first, in document order: the first textblock is the note's first line.
// Uses an explicit stack so arbitrarily deep input can't overflow the call stack.
function findFirstTextblock(doc: Node): Node | null {
  const stack = children(doc).toReversed();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isNode(node)) continue;
    if (typeof node.type === "string" && TEXTBLOCKS.has(node.type)) return node;
    const kids = children(node);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return null;
}

function firstLineText(block: Node): string {
  let line = "";
  for (const child of children(block)) {
    if (!isNode(child)) continue;
    if (child.type === "hardBreak") break;
    if (typeof child.text !== "string") continue;
    const newline = child.text.indexOf("\n");
    if (newline !== -1) return line + child.text.slice(0, newline);
    line += child.text;
  }
  return line;
}

/** The title is the document's first line. Never throws. */
export function extractTitle(doc: unknown): string {
  if (!isNode(doc)) return "Untitled";
  const block = findFirstTextblock(doc);
  const title = block ? firstLineText(block).replace(/\s+/g, " ").trim() : "";
  return title || "Untitled";
}

// Marks the end of a textblock on the walk stack, so a newline follows its text.
const BLOCK_END = Symbol("block end");

/**
 * The note's plain text, for search: every text node in document order, a newline after each
 * textblock and for each hard break (so words in different lines never run together). Images and
 * rules add nothing. Never throws.
 */
export function extractText(doc: unknown): string {
  if (!isNode(doc)) return "";
  const parts: string[] = [];
  const stack: unknown[] = children(doc).toReversed();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === BLOCK_END) {
      parts.push("\n");
      continue;
    }
    if (!isNode(node)) continue;
    if (node.type === "text" && typeof node.text === "string") {
      parts.push(node.text);
      continue;
    }
    if (node.type === "hardBreak") {
      parts.push("\n");
      continue;
    }
    if (typeof node.type === "string" && TEXTBLOCKS.has(node.type)) stack.push(BLOCK_END);
    const kids = children(node);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return parts.join("");
}
