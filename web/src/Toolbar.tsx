import type { MouseEvent } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
const HEADING_LEVELS: HeadingLevel[] = [1, 2, 3, 4, 5, 6];

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

function shortcutLabel(keys: string): string {
  return IS_MAC ? keys.replace("Mod", "⌘").replace("Alt", "⌥") : keys.replace("Mod", "Ctrl");
}

/** The aria-keyshortcuts form, e.g. "Control+Shift+S" or "Meta+B". */
function ariaShortcut(keys: string): string {
  return keys.replace("Mod", IS_MAC ? "Meta" : "Control");
}

/** Bare hosts like "example.com" get https://; otherwise they'd be stored as relative links. */
function normalizeHref(input: string): string {
  const href = input.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(href);
  if (href === "" || hasScheme || href.startsWith("/") || href.startsWith("#")) return href;
  return `https://${href}`;
}

// Keep focus (and the selection) in the editor when a toolbar button is clicked.
const keepEditorFocus = (event: MouseEvent) => event.preventDefault();

type ToolProps = {
  icon: LucideIcon;
  label: string;
  /** StarterKit's own shortcut, shown in the tooltip; "Mod" becomes Ctrl or ⌘, "Alt" ⌥ on Mac. */
  keys?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
};

function Tool({ icon: Icon, label, keys, onClick, active, disabled }: ToolProps) {
  return (
    <button
      type="button"
      className="tool"
      aria-label={label}
      title={keys ? `${label} (${shortcutLabel(keys)})` : label}
      aria-keyshortcuts={keys ? ariaShortcut(keys) : undefined}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={keepEditorFocus}
      onClick={onClick}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}

function Divider() {
  return <div className="tool-divider" role="separator" aria-orientation="vertical" />;
}

export function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      headingLevel: HEADING_LEVELS.find((level) => editor.isActive("heading", { level })) ?? 0,
      bold: editor.isActive("bold"),
      canBold: editor.can().toggleBold(),
      italic: editor.isActive("italic"),
      canItalic: editor.can().toggleItalic(),
      underline: editor.isActive("underline"),
      canUnderline: editor.can().toggleUnderline(),
      strike: editor.isActive("strike"),
      canStrike: editor.can().toggleStrike(),
      code: editor.isActive("code"),
      canCode: editor.can().toggleCode(),
      link: editor.isActive("link"),
      canLink: editor.can().setLink({ href: "https://example.com" }),
      selectionEmpty: editor.state.selection.empty,
      bulletList: editor.isActive("bulletList"),
      canBulletList: editor.can().toggleBulletList(),
      orderedList: editor.isActive("orderedList"),
      canOrderedList: editor.can().toggleOrderedList(),
      blockquote: editor.isActive("blockquote"),
      canBlockquote: editor.can().toggleBlockquote(),
      codeBlock: editor.isActive("codeBlock"),
      canCodeBlock: editor.can().toggleCodeBlock(),
      canHorizontalRule: editor.can().setHorizontalRule(),
    }),
  });

  const chain = () => editor.chain().focus();

  function setBlockStyle(value: string) {
    if (value === "p") chain().setParagraph().run();
    else chain().setHeading({ level: Number(value) as HeadingLevel }).run();
  }

  function editLink() {
    const current = editor.getAttributes("link").href as string | undefined;
    const input = window.prompt("Link URL (leave empty to remove)", current ?? "https://");
    if (input === null) return;
    const href = normalizeHref(input);
    if (href === "https://") return; // the untouched default
    if (href === "") {
      chain().extendMarkRange("link").unsetLink().run();
      return;
    }
    // Check first: a refused setLink would still apply extendMarkRange's selection change.
    if (!editor.can().chain().extendMarkRange("link").setLink({ href }).run()) {
      window.alert(`"${href}" isn't an allowed link.`);
      return;
    }
    chain().extendMarkRange("link").setLink({ href }).run();
  }

  // unsetAllMarks() does nothing at a collapsed cursor, so also drop marks queued for typing.
  function clearFormatting() {
    chain()
      .unsetAllMarks()
      .clearNodes()
      .command(({ tr }) => {
        tr.setStoredMarks([]);
        return true;
      })
      .run();
  }

  return (
    <div className="toolbar-row">
      {/* role="group", not "toolbar": every control is a plain tab stop (no arrow-key roving). */}
      <div className="toolbar" role="group" aria-label="Formatting">
        <Tool icon={Undo2} label="Undo" keys="Mod+Z" onClick={() => chain().undo().run()} disabled={!state.canUndo} />
        <Tool icon={Redo2} label="Redo" keys="Mod+Shift+Z" onClick={() => chain().redo().run()} disabled={!state.canRedo} />
        <Divider />
        <select
          className="tool-select"
          aria-label="Text style"
          title="Text style"
          value={state.codeBlock ? "code" : state.headingLevel ? String(state.headingLevel) : "p"}
          onChange={(event) => setBlockStyle(event.target.value)}
        >
          {/* Shown (not choosable) in a code block, so picking "Normal text" there fires onChange. */}
          <option value="code" disabled hidden>
            Code block
          </option>
          <option value="p">Normal text</option>
          {HEADING_LEVELS.map((level) => (
            <option key={level} value={level}>
              Heading {level}
            </option>
          ))}
        </select>
        <Divider />
        <Tool icon={Bold} label="Bold" keys="Mod+B" onClick={() => chain().toggleBold().run()} active={state.bold} disabled={!state.canBold} />
        <Tool icon={Italic} label="Italic" keys="Mod+I" onClick={() => chain().toggleItalic().run()} active={state.italic} disabled={!state.canItalic} />
        <Tool icon={Underline} label="Underline" keys="Mod+U" onClick={() => chain().toggleUnderline().run()} active={state.underline} disabled={!state.canUnderline} />
        <Tool icon={Strikethrough} label="Strikethrough" keys="Mod+Shift+S" onClick={() => chain().toggleStrike().run()} active={state.strike} disabled={!state.canStrike} />
        <Tool icon={Code} label="Inline code" keys="Mod+E" onClick={() => chain().toggleCode().run()} active={state.code} disabled={!state.canCode} />
        <Divider />
        <Tool
          icon={LinkIcon}
          label="Link"
          onClick={editLink}
          active={state.link}
          disabled={!state.link && (state.selectionEmpty || !state.canLink)}
        />
        <Divider />
        <Tool icon={List} label="Bulleted list" keys="Mod+Shift+8" onClick={() => chain().toggleBulletList().run()} active={state.bulletList} disabled={!state.canBulletList} />
        <Tool icon={ListOrdered} label="Numbered list" keys="Mod+Shift+7" onClick={() => chain().toggleOrderedList().run()} active={state.orderedList} disabled={!state.canOrderedList} />
        <Divider />
        <Tool icon={Quote} label="Quote" keys="Mod+Shift+B" onClick={() => chain().toggleBlockquote().run()} active={state.blockquote} disabled={!state.canBlockquote} />
        <Tool icon={SquareCode} label="Code block" keys="Mod+Alt+C" onClick={() => chain().toggleCodeBlock().run()} active={state.codeBlock} disabled={!state.canCodeBlock} />
        <Tool icon={Minus} label="Horizontal line" onClick={() => chain().setHorizontalRule().run()} disabled={!state.canHorizontalRule} />
        <Divider />
        <Tool icon={RemoveFormatting} label="Clear formatting" onClick={clearFormatting} />
      </div>
    </div>
  );
}
