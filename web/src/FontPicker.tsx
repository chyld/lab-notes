import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { isMacOS, type Editor } from "@tiptap/react";
import { ChevronDown, Star } from "lucide-react";
import { errorMessage } from "./api.ts";
import { setTextStyle } from "./editor.ts";
import {
  cachedFavoriteFonts,
  fetchFavoriteFonts,
  saveFavoriteFont,
  setCachedFavoriteFonts,
} from "./favoriteFonts.ts";
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

const IS_MAC = isMacOS();
const FAVORITE_KEYS = IS_MAC ? "⌘D" : "Ctrl+D";

/** Ctrl+D, or ⌘D on macOS: exactly that modifier. */
const isFavoriteShortcut = (event: KeyboardEvent) =>
  event.key.toLowerCase() === "d" &&
  (IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
  !event.altKey &&
  !event.shiftKey;

// A row is identified by its group and family ("default", "fav:Lobster", "all:Lobster"), since a
// favorite is listed twice. Ids can't hold spaces; families never contain "-", so this is unique.
const optionId = (key: string) => `font-option-${key.replace(/ /g, "-")}`;

type Row = { key: string; font: CatalogFont | null };

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
  // The highlighted row, by key; `scroll` when it moved by keyboard or search (not hover: hovering
  // a half-visible row would scroll the list under the pointer).
  const [active, setActiveState] = useState({ key: "default", scroll: true });
  // Favorites: the cached list until this open's fetch answers. Stars work only once it has
  // ("ready"): before then the picker doesn't know what's starred.
  const favoritesRef = useRef(cachedFavoriteFonts());
  const [favorites, setFavoritesState] = useState(favoritesRef.current);
  const [favoritesStatus, setFavoritesStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Per family, bumped on every toggle: a failed write is undone only if it's still the latest.
  const toggles = useRef(new Map<string, number>());
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const position = usePopoverPosition(anchor, POPOVER_WIDTH);
  const onBlur = useDismiss(popoverRef, anchor, onClose);

  useEffect(() => {
    let alive = true;
    loadCatalog().then(
      (list) => alive && setFonts(list),
      () => alive && setLoadFailed(true),
    );
    fetchFavoriteFonts().then(
      (list) => {
        if (!alive) return;
        setFavorites(list);
        setFavoritesStatus("ready");
      },
      () => alive && setFavoritesStatus("failed"),
    );
    return () => {
      alive = false;
    };
  }, []);

  function setFavorites(list: string[]) {
    favoritesRef.current = list;
    setCachedFavoriteFonts(list);
    setFavoritesState(list);
  }

  const setActive = useCallback((key: string, scroll: boolean) => {
    setActiveState((prev) => (prev.key === key && !scroll ? prev : { key, scroll }));
  }, []);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      (fonts ?? []).filter(
        ([family, cat]) => (!category || cat === category) && (!q || family.toLowerCase().includes(q)),
      ),
    [fonts, q, category],
  );
  // Favorites that are catalog families and match the search and category, in the order added.
  const favoriteMatches = useMemo(() => {
    const byFamily = new Map((fonts ?? []).map((font) => [font[0], font]));
    return favorites
      .map((family) => byFamily.get(family))
      .filter(
        (font): font is CatalogFont =>
          font !== undefined && (!category || font[1] === category) && (!q || font[0].toLowerCase().includes(q)),
      );
  }, [fonts, favorites, q, category]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const grouped = favoriteMatches.length > 0;

  // Every option in display order, for ↑/↓ and Enter.
  const rows = useMemo<Row[]>(
    () => [
      { key: "default", font: null },
      ...favoriteMatches.map((font) => ({ key: `fav:${font[0]}`, font })),
      ...matches.map((font) => ({ key: `all:${font[0]}`, font })),
    ],
    [favoriteMatches, matches],
  );
  const activeIndex = Math.max(
    0,
    rows.findIndex((row) => row.key === active.key),
  );
  const activeRow = rows[activeIndex];

  // Where the highlight starts: once the catalog is in (again when the favorites fetch settles,
  // since the Favorites group can change it), and on every search or category change. Toggling a
  // favorite doesn't move it.
  const favoritesSettled = favoritesStatus !== "loading";
  useEffect(() => {
    if (fonts === null) return;
    if (q) {
      const first = favoriteMatches[0] ?? null;
      setActive(first ? `fav:${first[0]}` : matches[0] ? `all:${matches[0][0]}` : "default", true);
    } else if (current === null) {
      setActive("default", true);
    } else if (grouped) {
      // Open at the top, with the favorites in view.
      setActive(favoriteMatches.some(([family]) => family === current) ? `fav:${current}` : "default", true);
    } else {
      setActive(matches.some(([family]) => family === current) ? `all:${current}` : "default", true);
    }
    // Not the favorites list itself: a toggle changes it but must not move the highlight.
  }, [fonts, favoritesSettled, q, category, current]);

  useEffect(() => {
    if (active.scroll) document.getElementById(optionId(active.key))?.scrollIntoView({ block: "nearest" });
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

  function toggleFavorite(family: string, fromKeyboard: boolean) {
    if (favoritesStatus !== "ready") return;
    const before = favoritesRef.current;
    const wasFavorite = before.includes(family);
    const index = before.indexOf(family);
    setFavorites(wasFavorite ? before.filter((f) => f !== family) : [...before, family]);
    const toggle = (toggles.current.get(family) ?? 0) + 1;
    toggles.current.set(family, toggle);
    setFavoriteError(null);
    setAnnouncement(wasFavorite ? `Removed ${family} from favorites` : `Added ${family} to favorites`);
    // The highlighted Favorites row is going away: keep the highlight on the same font.
    if (wasFavorite && active.key === `fav:${family}`) setActive(`all:${family}`, fromKeyboard);
    saveFavoriteFont(family, !wasFavorite).catch((err: unknown) => {
      if (toggles.current.get(family) !== toggle) return; // toggled again since: the newer one wins
      const now = favoritesRef.current;
      if (wasFavorite && !now.includes(family)) {
        setFavorites([...now.slice(0, index), family, ...now.slice(index)]);
      } else if (!wasFavorite) {
        setFavorites(now.filter((f) => f !== family));
      }
      setFavoriteError(`Couldn't update favorites: ${errorMessage(err)}`);
    });
  }

  // Stable handlers so memoized rows only re-render when their own props change.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const pick = useCallback((font: CatalogFont | null) => applyRef.current(font), []);
  const toggleRef = useRef(toggleFavorite);
  toggleRef.current = toggleFavorite;
  const star = useCallback((family: string) => toggleRef.current(family, false), []);
  const hover = useCallback((key: string) => setActive(key, false), [setActive]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      editor.commands.focus();
      return;
    }
    // Arrows and Enter drive the list only from the search box; Enter on a chip toggles the chip.
    if (event.target !== searchRef.current) return;
    if (isFavoriteShortcut(event)) {
      event.preventDefault(); // not the browser's bookmark shortcut
      if (event.repeat || event.nativeEvent.isComposing) return;
      if (activeRow.font) toggleFavorite(activeRow.font[0], true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // From the latest highlight, so two presses before a render move two rows.
      setActiveState((prev) => {
        const from = Math.max(0, rows.findIndex((row) => row.key === prev.key));
        return { key: rows[Math.min(rows.length - 1, Math.max(0, from + step))].key, scroll: true };
      });
    } else if (event.key === "Enter") {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (fonts === null) return; // catalog still loading: don't apply "Default" by accident
      if (q && matches.length === 0) return; // nothing to pick
      apply(activeRow.font);
    }
  }

  const canFavorite = favoritesStatus === "ready";
  // The current font's first row carries aria-selected (both copies show the current-font color).
  const currentInFavorites = favoriteMatches.some(([family]) => family === current);
  const fontRow = (key: string, font: CatalogFont, selected: boolean) => (
    <FontRow
      key={key}
      rowKey={key}
      font={font}
      active={key === activeRow.key}
      current={font[0] === current}
      selected={selected}
      favorite={favoriteSet.has(font[0])}
      canFavorite={canFavorite}
      onHover={hover}
      onPick={pick}
      onStar={star}
    />
  );

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
        aria-activedescendant={optionId(activeRow.key)}
        aria-keyshortcuts={IS_MAC ? "Meta+D" : "Control+D"}
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
      {/* The APG grouped listbox: groups labelled by a presentational heading. */}
      <div id="font-list" className="font-list" role="listbox" aria-label="Fonts">
        <ul className="font-group" role="presentation">
          <FontRow
            rowKey="default"
            font={null}
            active={activeRow.key === "default"}
            current={current === null}
            selected={current === null}
            favorite={false}
            canFavorite={false}
            onHover={hover}
            onPick={pick}
            onStar={star}
          />
        </ul>
        {grouped && (
          <ul className="font-group" role="group" aria-labelledby="font-group-favorites">
            <li id="font-group-favorites" className="font-group-heading" role="presentation">
              Favorites
            </li>
            {favoriteMatches.map((font) => fontRow(`fav:${font[0]}`, font, font[0] === current))}
          </ul>
        )}
        <ul
          className="font-group"
          role={grouped ? "group" : "presentation"}
          aria-labelledby={grouped ? "font-group-all" : undefined}
        >
          {grouped && (
            <li id="font-group-all" className="font-group-heading" role="presentation">
              All fonts
            </li>
          )}
          {matches.map((font) => fontRow(`all:${font[0]}`, font, font[0] === current && !currentInFavorites))}
        </ul>
      </div>
      {fonts === null && !loadFailed && <p className="font-empty">Loading fonts…</p>}
      {loadFailed && <p className="font-empty">Couldn't load the font list. Close and try again.</p>}
      {fonts !== null && matches.length === 0 && <p className="font-empty">No fonts match</p>}
      {favoriteError && (
        <p className="font-error" role="alert">
          {favoriteError}
        </p>
      )}
      <div className="visually-hidden" role="status">
        {announcement}
      </div>
    </div>,
    document.body,
  );
}

type RowProps = {
  rowKey: string;
  font: CatalogFont | null;
  active: boolean;
  /** The current font's color (both copies of a favorite). */
  current: boolean;
  /** aria-selected: the current font's first row only. */
  selected: boolean;
  favorite: boolean;
  /** Stars respond (the favorites list has loaded). */
  canFavorite: boolean;
  onHover: (key: string) => void;
  onPick: (font: CatalogFont | null) => void;
  onStar: (family: string) => void;
};

// Memoized: with ~1,700 rows, only the rows whose own props changed re-render.
const FontRow = memo(function FontRow(props: RowProps) {
  const { rowKey, font, active, current, selected, favorite, canFavorite, onHover, onPick, onStar } = props;
  const classes = ["font-option", active && "active", current && "current"].filter(Boolean).join(" ");
  return (
    <li
      id={optionId(rowKey)}
      role="option"
      aria-selected={selected}
      className={classes}
      data-family={font?.[0]}
      style={font ? { fontFamily: fontStack(font[0], font[1]) } : undefined}
      ref={font ? observePreview : undefined}
      onMouseMove={() => onHover(rowKey)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(font)}
    >
      <span className="font-option-name">{font?.[0] ?? "Default"}</span>
      {favorite && <span className="visually-hidden">, favorite</span>}
      {font && (favorite || canFavorite) && (
        // Decorative for screen readers (an option's contents aren't exposed): the state is in the
        // option's name, the keyboard path is Ctrl+D.
        <span
          className={favorite ? "font-star on" : "font-star"}
          aria-hidden
          title={`${favorite ? "Remove from" : "Add to"} favorites (${FAVORITE_KEYS})`}
          onClick={(event) => {
            event.stopPropagation(); // starring doesn't apply the font
            onStar(font[0]);
          }}
        >
          <Star size={16} fill={favorite ? "currentColor" : "none"} />
        </span>
      )}
    </li>
  );
});
