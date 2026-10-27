import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Hash,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Save,
  SquareCode,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { FontPicker } from "./FontPicker.tsx";
import { FontSizeControl, sizeAtSelection } from "./FontSizeControl.tsx";
import { HighlightPicker } from "./HighlightPicker.tsx";
import { markAt, textStyleAt } from "./editor.ts";
import { primaryFamily } from "./fonts.ts";
import { DEFAULT_HIGHLIGHT } from "./highlights.ts";
import { Divider, Tool } from "./ToolButton.tsx";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
const HEADING_LEVELS: HeadingLevel[] = [1, 2, 3, 4, 5, 6];

/**
 * Bare hosts like "example.com" or "localhost:3000" get https:// (otherwise they'd be stored as
 * relative links, or "localhost:" would be read as a scheme); bare emails get mailto:.
 */
function normalizeHref(input: string): string {
  const href = input.trim();
  if (href === "" || href.startsWith("/") || href.startsWith("#")) return href;
  if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(href)) return `mailto:${href}`;
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d+(?:[/?#]|$))/i.test(href);
  return hasScheme ? href : `https://${href}`;
}

/** A scheme with nothing after it, like the untouched "https://" default. */
const isSchemeOnly = (href: string) => /^[a-z][a-z0-9+.-]*:\/*$/i.test(href);

type Props = {
  editor: Editor;
  /** Unsaved changes and no save in flight. */
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  lineNumbers: boolean;
  onToggleLineNumbers: () => void;
};

export function Toolbar({ editor, canSave, saving, onSave, lineNumbers, onToggleLineNumbers }: Props) {
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
      fontFamily: primaryFamily(textStyleAt(editor).fontFamily as string | undefined),
      canFont: editor.can().setFontFamily("serif"),
      fontSize: sizeAtSelection(editor),
      canFontSize: editor.can().setFontSize("12pt"),
      // A highlight with no color (==text==, or a pasted <mark>: null or "") shows as Yellow.
      highlight: (() => {
        const mark = markAt(editor, "highlight");
        return mark ? ((mark.attrs.color as string | null) || DEFAULT_HIGHLIGHT) : null;
      })(),
      canHighlight: editor.can().setHighlight({ color: DEFAULT_HIGHLIGHT }),
    }),
  });

  // Mouse clicks return focus to the editor; keyboard activation leaves it on the toolbar so the
  // next control is one Tab away. Either way the command applies to the editor's selection.
  const chain = (fromKeyboard = false) => (fromKeyboard ? editor.chain() : editor.chain().focus());

  function setBlockStyle(value: string) {
    if (value === "p") chain().setParagraph().run();
    else chain().setHeading({ level: Number(value) as HeadingLevel }).run();
  }

  function editLink(fromKeyboard: boolean) {
    const current = editor.getAttributes("link").href as string | undefined;
    // Extend over the link whose URL the prompt shows. Between two adjacent links, a bare
    // extendMarkRange("link") would pick the other one.
    const which = current === undefined ? undefined : { href: current };
    const input = window.prompt("Link URL (leave empty to remove)", current ?? "https://");
    if (input === null) return;
    const href = normalizeHref(input);
    if (isSchemeOnly(href)) return; // e.g. the untouched "https://" default
    if (href === "") {
      chain(fromKeyboard).extendMarkRange("link", which).unsetLink().run();
      return;
    }
    // Check first: a refused setLink would still apply extendMarkRange's selection change.
    if (!editor.can().chain().extendMarkRange("link", which).setLink({ href }).run()) {
      window.alert(`"${href}" isn't an allowed link.`);
      return;
    }
    chain(fromKeyboard).extendMarkRange("link", which).setLink({ href }).run();
  }

  // unsetAllMarks() does nothing at a collapsed cursor, so also drop marks queued for typing.
  function clearFormatting(fromKeyboard: boolean) {
    chain(fromKeyboard)
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
        {/* Save (disk icon, user request) leads the bar. Like the other buttons it keeps focus in
            the editor; a tag typed but not yet added is saved too (NoteEditor's save adds it). */}
        <Tool icon={Save} label={saving ? "Saving…" : "Save"} onClick={onSave} disabled={!canSave} className="tool-save" />
        <Divider />
        <Tool icon={Undo2} label="Undo" keys="Mod+Z" onClick={(k) => chain(k).undo().run()} disabled={!state.canUndo} />
        <Tool icon={Redo2} label="Redo" keys="Mod+Shift+Z" onClick={(k) => chain(k).redo().run()} disabled={!state.canRedo} />
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
        <FontPicker editor={editor} current={state.fontFamily} disabled={!state.canFont} />
        <Divider />
        <FontSizeControl editor={editor} size={state.fontSize} disabled={!state.canFontSize} />
        <Divider />
        <Tool icon={Bold} label="Bold" keys="Mod+B" onClick={(k) => chain(k).toggleBold().run()} active={state.bold} disabled={!state.canBold} />
        <Tool icon={Italic} label="Italic" keys="Mod+I" onClick={(k) => chain(k).toggleItalic().run()} active={state.italic} disabled={!state.canItalic} />
        <Tool icon={Underline} label="Underline" keys="Mod+U" onClick={(k) => chain(k).toggleUnderline().run()} active={state.underline} disabled={!state.canUnderline} />
        <Tool icon={Strikethrough} label="Strikethrough" keys="Mod+Shift+S" onClick={(k) => chain(k).toggleStrike().run()} active={state.strike} disabled={!state.canStrike} />
        <Tool icon={Code} label="Inline code" keys="Mod+E" onClick={(k) => chain(k).toggleCode().run()} active={state.code} disabled={!state.canCode} />
        <HighlightPicker editor={editor} current={state.highlight} disabled={!state.canHighlight} />
        <Divider />
        <Tool
          icon={LinkIcon}
          label="Link"
          onClick={editLink}
          active={state.link}
          disabled={!state.link && (state.selectionEmpty || !state.canLink)}
        />
        <Divider />
        <Tool icon={List} label="Bulleted list" keys="Mod+Shift+8" onClick={(k) => chain(k).toggleBulletList().run()} active={state.bulletList} disabled={!state.canBulletList} />
        <Tool icon={ListOrdered} label="Numbered list" keys="Mod+Shift+7" onClick={(k) => chain(k).toggleOrderedList().run()} active={state.orderedList} disabled={!state.canOrderedList} />
        <Divider />
        <Tool icon={Quote} label="Quote" keys="Mod+Shift+B" onClick={(k) => chain(k).toggleBlockquote().run()} active={state.blockquote} disabled={!state.canBlockquote} />
        <Tool icon={SquareCode} label="Code block" keys="Mod+Alt+C" onClick={(k) => chain(k).toggleCodeBlock().run()} active={state.codeBlock} disabled={!state.canCodeBlock} />
        <Tool icon={Minus} label="Horizontal line" onClick={(k) => chain(k).setHorizontalRule().run()} disabled={!state.canHorizontalRule} />
        <Divider />
        <Tool icon={RemoveFormatting} label="Clear formatting" onClick={clearFormatting} />
        <Divider />
        {/* A view setting: it never touches the document. Focus follows the same rule as above. */}
        <Tool
          icon={Hash}
          label="Line numbers"
          onClick={(fromKeyboard) => {
            onToggleLineNumbers();
            if (!fromKeyboard) editor.commands.focus();
          }}
          active={lineNumbers}
        />
      </div>
    </div>
  );
}
