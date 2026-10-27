import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { setTextStyle } from "./editor.ts";
import { ChevronDown } from "lucide-react";
import {
  CATEGORIES,
  fontStack,
  loadCatalog,
  loadFont,
  loadPreview,
  type CatalogFont,
  type FontCategory,
} from "./fonts.ts";
import { useDismiss, usePopoverPosition } from "./popover.ts";

const POPOVER_WIDTH = 300;

// One observer for all rows: a row's preview font loads the first time it scrolls into view.
let previewObserver: IntersectionObserver | null = null;

function observePreview(el: HTMLElement | null) {
  if (!el) return;
  previewObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      loadPreview((entry.target as HTMLElement).dataset.family ?? "");
      previewObserver?.unobserve(entry.target);
    }
  });
  previewObserver.observe(el);
  return () => {
    previewObserver?.unobserve(el);
  };
}

type Props = { editor: Editor; current: string | null };

export function FontPicker({ editor, current, disabled }: Props & { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="tool-select font-button"
        aria-label={`Font: ${current ?? "Default"}`}
        title="Font"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-button-name">{current ?? "Default"}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && buttonRef.current && (
        <FontPopover editor={editor} current={current} anchor={buttonRef.current} onClose={close} />
      )}
    </>
  );
}

type PopoverProps = Props & { anchor: HTMLElement; onClose: () => void };

function FontPopover({ editor, current, anchor, onClose }: PopoverProps) {
  const [fonts, setFonts] = useState<CatalogFont[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FontCategory | null>(null);
  // Index into rows; row 0 is "Default".
  const [active, setActive] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const position = usePopoverPosition(anchor, POPOVER_WIDTH);
  const onBlur = useDismiss(popoverRef, anchor, onClose);

  useEffect(() => {
    let alive = true;
    loadCatalog().then(
      (list) => alive && setFonts(list),
      () => alive && setLoadFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (fonts ?? []).filter(
      ([family, cat]) => (!category || cat === category) && (!q || family.toLowerCase().includes(q)),
    );
  }, [fonts, query, category]);

  const rows: (CatalogFont | null)[] = [null, ...matches];

  // Scroll the highlight into view only when it moves by keyboard or search, not on hover (hovering
  // a half-visible row would scroll the list under the pointer).
  const scrollToActive = useRef(true);

  // A search highlights its first match; with no search, the current font (or "Default").
  useEffect(() => {
    scrollToActive.current = true;
    if (query.trim()) {
      setActive(matches.length > 0 ? 1 : 0);
    } else {
      setActive(matches.findIndex(([family]) => family === current) + 1);
    }
  }, [query, matches, current]);

  useEffect(() => {
    if (!scrollToActive.current) return;
    scrollToActive.current = false;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function apply(font: CatalogFont | null) {
    if (font) {
      loadFont(font[0]);
      setTextStyle(editor, editor.chain().focus(), { fontFamily: fontStack(font[0], font[1]) }).run();
    } else if (editor.state.selection.empty) {
      setTextStyle(editor, editor.chain().focus(), { fontFamily: null }).run();
    } else {
      editor.chain().focus().unsetFontFamily().run();
    }
    onClose();
  }

  // Stable handlers so memoized rows only re-render when their own props change.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const pick = useCallback((font: CatalogFont | null) => applyRef.current(font), []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      editor.commands.focus();
      return;
    }
    // Arrows and Enter drive the list only from the search box; Enter on a chip toggles the chip.
    if (event.target !== searchRef.current) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      scrollToActive.current = true;
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      scrollToActive.current = true;
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (fonts === null) return; // catalog still loading: don't apply "Default" by accident
      if (query.trim() && matches.length === 0) return; // nothing to pick
      apply(rows[active] ?? null);
    }
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="font-popover"
      role="dialog"
      aria-label="Fonts"
      style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <input
        ref={searchRef}
        className="font-search"
        type="search"
        placeholder="Search Google Fonts"
        aria-label="Search fonts"
        role="combobox"
        aria-expanded="true"
        aria-controls="font-list"
        aria-activedescendant={`font-option-${active}`}
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="font-categories" role="group" aria-label="Font category">
        {[null, ...CATEGORIES].map((cat) => (
          <button
            key={cat ?? "all"}
            type="button"
            className="font-chip"
            aria-pressed={category === cat}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setCategory(cat)}
          >
            {cat ?? "All"}
          </button>
        ))}
      </div>
      <ul id="font-list" ref={listRef} className="font-list" role="listbox" aria-label="Fonts">
        {rows.map((font, i) => (
          <FontRow
            key={font?.[0] ?? "default"}
            font={font}
            index={i}
            active={i === active}
            selected={(font?.[0] ?? null) === current}
            onHover={setActive}
            onPick={pick}
          />
        ))}
        {fonts === null && !loadFailed && <li className="font-empty">Loading fonts…</li>}
        {loadFailed && <li className="font-empty">Couldn't load the font list. Close and try again.</li>}
        {fonts !== null && matches.length === 0 && <li className="font-empty">No fonts match</li>}
      </ul>
    </div>,
    document.body,
  );
}

type RowProps = {
  font: CatalogFont | null;
  index: number;
  active: boolean;
  selected: boolean;
  onHover: (index: number) => void;
  onPick: (font: CatalogFont | null) => void;
};

// Memoized: with ~1,700 rows, only the rows whose active/selected state changed re-render.
const FontRow = memo(function FontRow({ font, index, active, selected, onHover, onPick }: RowProps) {
  return (
    <li
      id={`font-option-${index}`}
      role="option"
      aria-selected={selected}
      className={active ? "font-option active" : "font-option"}
      data-family={font?.[0]}
      style={font ? { fontFamily: fontStack(font[0], font[1]) } : undefined}
      ref={font ? observePreview : undefined}
      onMouseMove={() => onHover(index)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(font)}
    >
      {font?.[0] ?? "Default"}
    </li>
  );
});
