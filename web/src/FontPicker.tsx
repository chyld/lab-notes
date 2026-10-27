import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
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
        aria-haspopup="listbox"
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
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FontCategory | null>(null);
  // Index into rows; row 0 is "Default".
  const [active, setActive] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [position] = useState(() => {
    const rect = anchor.getBoundingClientRect();
    return { top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8)) };
  });

  useEffect(() => {
    let alive = true;
    loadCatalog().then((list) => alive && setFonts(list));
    return () => {
      alive = false;
    };
  }, []);

  // Close on a click outside (the button toggles itself), a resize, or any scroll outside the
  // popover (e.g. the toolbar scrolling sideways would leave the fixed popover behind).
  useEffect(() => {
    const outside = (target: EventTarget | null) =>
      !popoverRef.current?.contains(target as Node) && !anchor.contains(target as Node);
    const onPointerDown = (event: PointerEvent) => outside(event.target) && onClose();
    const onScroll = (event: Event) => outside(event.target) && onClose();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (fonts ?? []).filter(
      ([family, cat]) => (!category || cat === category) && (!q || family.toLowerCase().includes(q)),
    );
  }, [fonts, query, category]);

  const rows: (CatalogFont | null)[] = [null, ...matches];

  // A search highlights its first match; with no search, the current font (or "Default").
  useEffect(() => {
    if (query.trim()) {
      setActive(matches.length > 0 ? 1 : 0);
    } else {
      setActive(matches.findIndex(([family]) => family === current) + 1);
    }
  }, [query, matches, current]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function apply(font: CatalogFont | null) {
    if (font) {
      loadFont(font[0]);
      editor.chain().focus().setFontFamily(fontStack(font[0], font[1])).run();
    } else {
      editor.chain().focus().unsetFontFamily().run();
    }
    onClose();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (query.trim() && matches.length === 0) return; // nothing to pick
      apply(rows[active] ?? null);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      editor.commands.focus();
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
    >
      <input
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
        {rows.map((font, i) => {
          const family = font?.[0] ?? null;
          return (
            <li
              key={family ?? "default"}
              id={`font-option-${i}`}
              role="option"
              aria-selected={family === current}
              className={i === active ? "font-option active" : "font-option"}
              data-family={family ?? undefined}
              style={font ? { fontFamily: fontStack(font[0], font[1]) } : undefined}
              ref={font ? observePreview : undefined}
              onMouseMove={() => setActive(i)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(font)}
            >
              {family ?? "Default"}
            </li>
          );
        })}
        {fonts === null && <li className="font-empty">Loading fonts…</li>}
        {fonts !== null && matches.length === 0 && <li className="font-empty">No fonts match</li>}
      </ul>
    </div>,
    document.body,
  );
}
