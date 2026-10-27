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
