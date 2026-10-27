# Lab Notes — Spec

**Lab Notes** is a self-hosted notes app (the start of a Google Docs–style app) for a homelab. It has two screens:
a list of notes and a note editor. The editor engine is [Tiptap](https://tiptap.dev/).

## Scope

In scope, and nothing else:

1. **Notes list**: shows every note by title, with a "New note" button.
2. **Note editor**: edits one note in Tiptap and saves it **only when the Save button is clicked**.
3. **Title**: the note's title is its **first line**.
4. **Packaging**: one Docker image, run with Docker Compose, data on a persistent volume.
5. **Formatting toolbar** (added by user request): a Google Docs–style toolbar over the editor
   for the formatting StarterKit already supports. See [Toolbar](#toolbar).
6. **Fonts and font size** (added by user request): pick any Google Font by browsing/searching,
   linked from fonts.googleapis.com, and set font size. See [Fonts and size](#fonts-and-size).

Out of scope (the user will decide later): delete, autosave, unsaved-changes warnings, keyboard
save shortcut, search, folders, sharing, auth, real-time collaboration,
version history, dates or previews in the list, images/uploads.

## Stack

| Layer | Choice (pinned major) | Why |
|---|---|---|
| Runtime | Node 26 (`node:26-slim` image) | Built-in `node:sqlite` and native TypeScript type stripping: no server build step, no native modules. |
| Server | `fastify@^5`, `@fastify/static@^10` | Small, fast, JSON-schema validation, `inject()` for tests. |
| Database | SQLite via `node:sqlite` (`DatabaseSync`), WAL mode | One file, zero ops. |
| Frontend | `react@^19`, `react-dom@^19`, `vite@^8`, `@vitejs/plugin-react@^6` | Tiptap's first-class binding is React. |
| Editor | `@tiptap/react@^3`, `@tiptap/pm@^3`, `@tiptap/starter-kit@^3` | StarterKit defaults, except `link.openOnClick: false` (see Toolbar). |
| Routing | `react-router@^8`, declarative mode (`BrowserRouter`, `Routes`, `Route`) | Two routes, plus a catch-all "Page not found". |
| Types | `typescript@^7`, `@types/node@^26`, `@types/react@^19`, `@types/react-dom@^19` | `npm run typecheck`. |
| Styling | One plain CSS file | No UI framework. |
| Icons | `lucide-react@^1` (devDependency; tree-shaken into the bundle) | Toolbar icons. |
| Fonts | `@tiptap/extension-text-style@^3` (`TextStyle`, `FontFamily`, `FontSize`); Google Fonts CSS API | Font family and size. |
| Tests | `node:test` (built in) | Server title logic and API. |

The lockfile is the source of truth for exact versions.

## Project layout

Single `package.json` at the repo root with **`"type": "module"`**. Frontend libraries are
`devDependencies` (Vite bundles them at build time); `fastify` and `@fastify/static` are the only
`dependencies`, so `npm ci --omit=dev` yields a small runtime.

```
compose.yaml
Dockerfile
.dockerignore               # node_modules, dist, data, .git, server/**/*.test.ts
.gitignore                  # node_modules, dist, data
package.json
package-lock.json
tsconfig.server.json
tsconfig.web.json
vite.config.ts
server/
  index.ts                  # entry: reads env, builds app, listens, handles SIGTERM/SIGINT
  app.ts                    # buildApp({ dbPath, staticDir? }) -> Fastify instance
  db.ts                     # openDb(path): mkdir, open, PRAGMA, schema, statements
  title.ts                  # extractTitle(doc: unknown) -> string
  title.test.ts
  app.test.ts
web/
  index.html                # links the favicon and apple-touch-icon
  public/
    logo.svg                # Lab Notes logo; also the favicon
    apple-touch-icon.png    # 180px, for phone home screens
  src/
    main.tsx                # router setup
    api.ts                  # typed fetch helpers
    editor.ts               # shared Tiptap extensions + content validation
    NotesList.tsx           # route "/"
    NotePage.tsx            # route "/notes/:id" (id may be "new"): loading
    NoteEditor.tsx          # the Tiptap editor and Save
    Toolbar.tsx             # formatting toolbar for the editor
    ToolButton.tsx          # shared toolbar icon button + divider
    FontPicker.tsx          # Google Fonts browser (toolbar control)
    FontSizeControl.tsx     # − [size] + (toolbar control)
    fonts.ts                # catalog loading, Google Fonts <link> loading, font-family values
    google-fonts.json       # generated catalog: [family, category][] by popularity
scripts/
  update-google-fonts.ts    # regenerates web/src/google-fonts.json (npm run fonts:update)
    TopBar.tsx              # "← Lab Notes" bar shared by the note screens
    styles.css
```

### Server TypeScript rules (Node 26 type stripping)

Node runs `server/*.ts` directly; it ignores `tsconfig` and only erases types. So:

- Relative imports use explicit `.ts` extensions (`import { openDb } from "./db.ts"`).
- Type-only imports use `import type`.
- Only erasable syntax (no `enum`, `namespace`, parameter properties).

`tsconfig.server.json` enforces this: `module`/`moduleResolution: "nodenext"`, `target: "esnext"`,
`strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`,
`skipLibCheck`, `types: ["node"]`, `include: ["server/**/*.ts"]`.

`tsconfig.web.json`: `module: "esnext"`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`,
`lib: ["esnext", "dom", "dom.iterable"]`, `strict`, `noEmit`, `allowImportingTsExtensions`,
`verbatimModuleSyntax`, `skipLibCheck`, `types: ["vite/client", "node"]`,
`include: ["web/src/**/*.ts", "web/src/**/*.tsx", "vite.config.ts"]`.

### Vite

`vite.config.ts`: `root: "web"`, `build.outDir: "../dist/web"` (relative to `root`), and
`build.emptyOutDir: true` (needed because the output is outside `root`). Dev server proxies
`/api` to `http://localhost:${process.env.PORT || 5555}`.

## Data model

```sql
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,   -- crypto.randomUUID()
  title      TEXT NOT NULL,      -- derived from content on every save
  content    TEXT NOT NULL,      -- Tiptap JSON (JSON.stringify of the request's content)
  created_at TEXT NOT NULL,      -- ISO 8601 UTC
  updated_at TEXT NOT NULL       -- ISO 8601 UTC
);
```

`openDb(path)` creates the parent directory (`mkdirSync(dirname(path), { recursive: true })`)
unless `path` is `":memory:"`, opens `DatabaseSync`, runs `PRAGMA journal_mode = WAL;`, and creates
the table. The DB file is `$DATA_DIR/notes.db` (`DATA_DIR` defaults to `./data`). WAL mode puts
`notes.db-wal` and `notes.db-shm` beside it.

## Title rule

The title is computed **on the server** from the saved Tiptap JSON:

1. Walk the document depth-first, in order, descending into any node's `content` array. The first
   node whose `type` is a textblock (`paragraph`, `heading`, `codeBlock`) is the **first line**.
   Containers (lists, list items, blockquotes) are descended into, so a note starting with a
   bullet list is titled by the first item's text. Leaf blocks with no text (`horizontalRule`) are
   not lines and are skipped.
2. Concatenate that textblock's `text` children in order. The title ends at the first
   `hardBreak` node or the first `\n` in any text (code blocks), whichever comes first.
3. Collapse runs of whitespace to one space and trim. No length cap: the list truncates visually.
4. If the result is empty (empty first line, or no textblock at all), the title is `Untitled`.

`extractTitle` is total: it never throws. Non-object nodes, non-array `content`, and non-string
`text` are ignored, and the walk uses an explicit stack (no recursion), so no input depth or width
can overflow the call stack.

## API

All under `/api`, JSON in and out. POST/PUT require `Content-Type: application/json`.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/notes` | — | `200` `[{ id, title }]`, most recently saved first (`updated_at DESC, rowid DESC`: saves in the same millisecond list latest-inserted first) |
| `POST` | `/api/notes` | `{ content: Doc }` | `201` `Note` |
| `GET` | `/api/notes/:id` | — | `200` `Note`, or `404` |
| `PUT` | `/api/notes/:id` | `{ content: Doc }` | `200` `Note`, or `404` |

`Note` = `{ id, title, content, createdAt, updatedAt }` where `content` is the parsed Tiptap JSON.

`POST` and `PUT` set `title` from the title rule and `updated_at` (and `created_at` on create) to
the current time.

**Validation.** Fastify is constructed with `ajv: { customOptions: { coerceTypes: false } }` so
wrong types are rejected, not coerced. The body schema: `content` is required and is an object with
`type: { const: "doc" }` and a required `content` array with at least one item (ProseMirror's doc is
`block+`, so an empty doc could never be opened), whose items are objects. Extra properties are
allowed everywhere (never `additionalProperties: false`, which would strip Tiptap data). Nodes are
not deeply validated in the MVP.

**Depth limit.** Before any write, `POST`/`PUT` reject a document nested more than 200 JSON levels
deep (checked iteratively) with `400 { error: "Document is nested too deeply" }`. Each Tiptap node
level is two JSON levels, so this allows ~100 levels of nesting, far beyond real documents, and
keeps recursive JSON handling (serializing the reply) from overflowing the stack after a write.

**Errors.** Every error response is `{ "error": string }` with the original status:

- A `setErrorHandler` maps errors with a 4xx `statusCode` (validation 400, 413 body over Fastify's
  default 1 MiB limit, 415 bad content type) to `{ error: err.message }`, and anything else to
  `500 { error: "Internal server error" }` (logged).
- Fastify's `frameworkErrors` option maps errors raised before routing (e.g. a malformed
  `%`-escape in the URL → 400) to `{ error: err.message }`.
- The single `setNotFoundHandler` (below) returns `404 { error: "Not found" }` for API misses.
- Unknown note ids return `404 { error: "Note not found" }`.

## Static serving

`buildApp` registers `@fastify/static` only when `staticDir` contains `index.html` (`index.ts`
passes `resolve(import.meta.dirname, "../dist/web")`). The one `setNotFoundHandler`:

1. If the method is `GET` or `HEAD`, the path is not under `/api`, the last path segment has no
   file extension, and static serving is registered → `reply.sendFile("index.html")` (SPA
   fallback for `/notes/<id>`).
2. Otherwise → `404 { error: "Not found" }`.

So `POST /anything` is a JSON 404, never `index.html`, and a missing file such as a stale
`/assets/*.js` is a 404 rather than HTML served as JavaScript.

## Frontend

### `api.ts`

Typed helpers: `listNotes()`, `getNote(id)`, `createNote(content)`, `updateNote(id, content)`.
POST/PUT send `Content-Type: application/json`. A non-2xx response throws an `ApiError` carrying
`status` and the server's `error` message.

### `/` — Notes list (`NotesList.tsx`)

- Heading "Lab Notes" and a "New note" button that navigates to `/notes/new`.
- The list from `listNotes()`, each item a link to `/notes/:id` showing its title, truncated with a
  CSS ellipsis.
- States: loading, error (message), empty ("No notes yet").

### `/notes/:id` — Note page (`NotePage.tsx`)

Two components: **`NotePage`** (route element, owns loading) and **`NoteEditor`** (owns the Tiptap
instance and saving).

`NotePage`:

- Top bar: a "← Lab Notes" link to `/`, and the editor's Save button (rendered by `NoteEditor`).
- Keeps `session = { key, note }` state: `note` is `null` for a new note. It renders
  `<NoteEditor key={session.key} initialNote={session.note} onCreated={...} />` once ready, and
  loading / "Note not found" (with a link back) / error states otherwise.
- On each change of the route `id` (effect on `[id]`, with a cancelled flag for stale responses):
  - If `id` equals `createdIdRef.current` (the id this page just got back from `POST`), do
    nothing. This is the new-note → saved-note URL change: no refetch, no remount.
  - If `id === "new"`: `session = { key: "new", note: null }`.
  - Otherwise: show loading, `getNote(id)`, then `session = { key: id, note }`. Before mounting
    the editor, the content is validated against the StarterKit schema (`isValidContent` in
    `editor.ts`: `schema.nodeFromJSON(content).check()`, the same check Tiptap's
    `enableContentCheck` runs). Invalid content shows "This note can't be opened: its content is
    invalid." with no editor and no Save, so an invalid note is never shown blank and saved over.
    (Done here rather than via `onContentError`, which fires during React render.)
  - Each new-note session gets a fresh key (`new-1`, `new-2`, …; StrictMode's dev double-run may
    skip a number, which is harmless).
- `onCreated(id)`: set `createdIdRef.current = id`, then `navigate("/notes/" + id, { replace: true })`.
  `session.key` does not change, so `NoteEditor` is not remounted and keeps content and cursor.

`NoteEditor` (`useEditor` is always called unconditionally here, with no `deps` argument, because
deps would destroy and recreate the editor):

- `useEditor({ extensions, content: initialNote?.content ?? "", autofocus: initialNote ? false : "end", onUpdate })`.
  `content` applies only at creation, which is why `NotePage` mounts this component only after
  loading.
- Holds `noteId` in a ref, initialized from `initialNote?.id ?? null`. Save uses `PUT` when
  `noteId` is set, otherwise `POST`, then stores the returned id in the ref and calls
  `onCreated(id)`. Later saves `PUT`.
- **Dirty tracking:** `version` state starts at `0` and `onUpdate` increments it (`onUpdate` does
  not fire for the initial content, so a freshly opened note is clean). `savedVersion` starts at
  `0`. Dirty = `version !== savedVersion`. A save captures `v = version` when it starts; on
  success it sets `savedVersion = v`, so edits typed during a save stay unsaved. A failed save
  changes nothing.
- **Save button:** disabled when not dirty or while saving. A `savingRef`, set synchronously at
  the start of a save, also guards `save()`, because the `saving` state only disables the button
  after React re-renders; two clicks in one tick must not both `POST` (duplicate note). Label "Saving…" while in flight. A
  failure shows the `ApiError` message and re-enables Save; the content stays in the editor. Sends
  `editor.getJSON()`.
- **Leaving mid-save:** a `mountedRef` (set in an effect, cleared on cleanup) guards every
  post-await state update and the `onCreated` call, so a save that finishes after the user left
  completes its database write but changes nothing on screen.
- The editor is styled as a centered white page on a gray background, Google Docs–like.
- Unmatched client routes render "Page not found." with a link back to the list.
- Formatting comes from the [toolbar](#toolbar) and from StarterKit's keyboard shortcuts and
  Markdown-style input rules (`# ` heading, `- ` list, `Ctrl+B` bold), which keep working.

StarterKit v3 defaults include `Link` (autolinks pasted/typed URLs), `Underline`, `ListKeymap`,
and `TrailingNode` (keeps an empty paragraph at the end of the document, so saved JSON often ends
with one). These are expected.

### Toolbar

`Toolbar.tsx` renders one row directly under the top bar. The top bar and toolbar stick to the top
together while the page scrolls. It exposes what StarterKit v3 supports plus font family and size
(Tiptap's `TextStyle`, `FontFamily`, `FontSize`), in Google Docs order, as groups separated by thin
dividers. `ToolButton.tsx` holds the shared icon button (`Tool`) and divider:

| Group | Controls |
|---|---|
| History | Undo, Redo |
| Block style | A `<select>`: Normal text, Heading 1, Heading 2, Heading 3, Heading 4, Heading 5, Heading 6 |
| Font | Font picker (see [Fonts and size](#fonts-and-size)) |
| Size | Font size: `−` `[12]` `+` |
| Marks | Bold, Italic, Underline, Strikethrough, Inline code |
| Link | Link |
| Lists | Bulleted list, Numbered list |
| Blocks | Quote, Code block, Horizontal line |
| Clear | Clear formatting |

Nothing else: no colors, highlight, alignment, indent buttons, images, tables, or anything
StarterKit and the text-style extensions above don't include. StarterKit's shortcuts without a control (e.g. Shift+Enter
line break, `Ctrl+Alt+0`–`6` paragraph/heading) keep working.

Behavior:

- `NoteEditor` renders `<Toolbar editor={editor} />` under `TopBar`, only once `useEditor` has
  returned an editor (the prop is a non-null `Editor`). One `.editor-header` wrapper holds both
  rows and is the only sticky element.
- Each button runs `editor.chain().focus().<command>().run()` and cancels `mousedown`, so focus
  and selection stay in the editor. When a button is activated from the keyboard (Enter/Space,
  `event.detail === 0`) it runs without `.focus()`, so focus stays on the toolbar and the next
  control is one Tab away; the command still applies to the editor's selection. The select's `onChange` also runs through
  `editor.chain().focus()` (no `mousedown` cancel on the select, which would stop it opening).
  Commands: `undo`, `redo`, `toggleBold`, `toggleItalic`, `toggleUnderline`,
  `toggleStrike`, `toggleCode`, `toggleBulletList`, `toggleOrderedList`, `toggleBlockquote`,
  `toggleCodeBlock`, `setHorizontalRule`, and clear formatting =
  `unsetAllMarks().clearNodes()` plus clearing stored marks (so at a collapsed cursor, where
  `unsetAllMarks()` does nothing, a pending bold etc. is dropped). Like Tiptap's clear, it removes
  links and lifts the block out of lists and quotes.
- The block-style select (`aria-label="Text style"`) shows the current block:
  `isActive("heading", { level: N })` → `Heading N`; in a code block → a hidden, disabled
  `Code block` option (so choosing `Normal text` there does fire `onChange` and converts it);
  otherwise `Normal text`. Choosing `Normal text` runs `setParagraph()`; choosing `Heading N` runs
  `setHeading({ level: N })`. In a list item, `setHeading` lifts the line out of the list (Tiptap's
  `setNode` falls back to `clearNodes()`, since list items must start with a paragraph); that is
  accepted.
- **Link:** if the cursor or selection is in a link, the button is pressed. Clicking reads the
  current link's URL and opens `window.prompt("Link URL (leave empty to remove)", currentHref ??
  "https://")`. Every later step extends over *that* link (`extendMarkRange("link", { href:
  currentHref })`), so at the boundary between two adjacent links the edit hits the link the
  prompt showed. The answer is trimmed, then normalized:
  - a bare email (`user@example.com`) gets `mailto:`;
  - a value with no scheme that doesn't start with `/` or `#` gets `https://` (otherwise
    `example.com` would be stored as a relative link); `host:port` (`localhost:3000`) is not
    mistaken for a scheme.

  Then: cancel, or a scheme with nothing after it (the untouched `https://`, `HTTPS://`,
  `http://`), does nothing; empty removes the link (`unsetLink()`); otherwise, if `editor.can()`
  says `extendMarkRange(...).setLink({ href })` would succeed, it runs. Tiptap's `setLink` refuses
  unsafe URLs (e.g. `javascript:`) via `isAllowedUri`; checking first means a refusal changes
  nothing (not even the selection) and shows an alert. The button is disabled when not in a link
  and either the selection is empty or links aren't allowed there (code blocks).
  StarterKit is configured with `link: { openOnClick: false }` (the one change from its defaults):
  with the default, any plain click on a link opens it in a new tab and never places the cursor
  in it, so links couldn't be edited by mouse. Now a click places the cursor, like Google Docs.
- **State:** toolbar state comes from one Tiptap `useEditorState` selector that returns only
  primitives (booleans and the heading level), so the toolbar re-renders on selection and content
  changes. Mark, list, quote, and code-block buttons show
  pressed state (`aria-pressed`) from `editor.isActive(...)`. Undo, Redo, and each mark/list/block
  button are disabled when `editor.can()` says the command can't run (e.g. Undo with no history).
- **Dirty tracking** needs no change: toolbar commands that change the document fire `onUpdate`,
  which enables Save.
- **Accessibility:** the row is `role="group"` with `aria-label="Formatting"`, not
  `role="toolbar"`, because every control is a plain tab stop (no arrow-key roving tabindex).
  Every button is `type="button"` with an `aria-label` and a `title` tooltip that includes its
  shortcut when it has one, e.g. "Bold (Ctrl+B)"; on macOS (Tiptap's `isMacOS()`, the same check
  that decides what `Mod` binds to) it uses symbols, e.g. "Strikethrough (⌘⇧S)".
  Buttons with a shortcut also set `aria-keyshortcuts` (e.g. `Control+B`, `Meta+B` on macOS).
  Known trade-off: the select refocuses the editor on every `change`, and on Windows/Linux arrow
  keys on a closed select fire `change`, so keyboard users open it first (Alt+↓) and pick with
  Enter.
  Icons (lucide-react): `Undo2`, `Redo2`, `Bold`, `Italic`, `Underline`, `Strikethrough`, `Code`,
  `Link` (imported as `LinkIcon`), `List`, `ListOrdered`, `Quote`, `SquareCode`, `Minus`,
  `RemoveFormatting`.
- **Look:** Google Docs–like. Icon buttons (lucide icons, 18px) in a light gray rounded bar.
  Hover is a slightly darker gray; pressed is light blue (`#d3e3fd`) with a blue icon
  (`#0b57d0`); disabled is faded. On narrow screens the row scrolls horizontally rather than
  wrapping.
- Shortcuts shown in tooltips: Undo `Ctrl+Z`, Redo `Ctrl+Shift+Z`, Bold `Ctrl+B`, Italic `Ctrl+I`,
  Underline `Ctrl+U`, Strikethrough `Ctrl+Shift+S`, Inline code `Ctrl+E`, Bulleted list
  `Ctrl+Shift+8`, Numbered list `Ctrl+Shift+7`, Quote `Ctrl+Shift+B`, Code block `Ctrl+Alt+C`.
  (These are StarterKit's own bindings; the toolbar adds none.)

### Fonts and size

**Extensions.** `editor.ts` adds `TextStyle`, `FontFamily`, and `FontSize` from
`@tiptap/extension-text-style` to StarterKit. Font and size are attributes of the `textStyle`
mark, so they are saved in the note's JSON, apply to the selection (or, at a collapsed cursor, to
text typed next), and are removed by Clear formatting.

**Catalog.** `web/src/google-fonts.json` is a committed list of every Google Fonts family as
`[family, category]`, sorted by popularity (~1,950 entries; categories: Sans Serif, Serif,
Display, Handwriting, Monospace). `npm run fonts:update` regenerates it from
`https://fonts.google.com/metadata/fonts` (no API key; it can't be fetched at runtime because it
sends no CORS header). The app imports it lazily (`import()`) the first time the picker opens, so
it isn't in the main bundle.

**Loading fonts** (`fonts.ts`): fonts are linked from Google, as the user chose.

- `loadFont(family)` appends one `<link rel="stylesheet">` per family to `<head>`:
  `https://fonts.googleapis.com/css2?family=<Name+With+Plus>:ital,wght@0,400;0,700;1,400;1,700&display=swap`
  (regular, bold, italic, bold italic; Google tolerates missing variants).
- `loadPreview(family)` links `…/css2?family=<Name>&text=<the family name>` so a picker row can
  render its name in its own font while downloading only those glyphs.
- Both dedupe by family and only accept names matching `^[A-Za-z0-9 ]+$` (all catalog names do);
  anything else is ignored, so odd stored data can't build a strange URL.
- `loadFont` and `loadPreview` keep separate dedupe keys; a preview is skipped once the full font
  is linked, and the full font is always appended after any preview (a preview sheet has one face
  with only the name's glyphs and would otherwise shadow the full font).
- Fonts used by a note load when it opens (`onCreate`) and whenever its content changes
  (`onUpdate`): `loadDocumentFonts` scans the document's `textStyle` marks, takes each
  `fontFamily`'s first family (unquoted), and loads only families that are in the catalog, so a
  font pasted in from elsewhere (e.g. `Arial`) is never requested from Google.

**Stored value.** Choosing a font stores a CSS font stack, `"Family Name", <generic>`, where the
generic comes from the category (Serif → `serif`, Handwriting → `cursive`, Monospace →
`monospace`, Sans Serif and Display → `sans-serif`), so text degrades sensibly if Google is
unreachable. The UI shows the first family in the stack without quotes.

**Font picker** (`FontPicker.tsx`), in the toolbar after the text-style select:

- A button showing the font at the selection or `Default`, ~140px wide with an ellipsis,
  `aria-haspopup="listbox"`, `aria-expanded`. "At the selection" is `textStyleAt(editor)`
  (`editor.ts`): at a cursor, the stored marks if set (even an empty set, e.g. after Clear
  formatting) else the marks at the cursor; for a range, the marks of the node at its start.
  (`editor.getAttributes("textStyle")` returns the first textStyle anywhere in a range and ignores
  cleared stored marks, so it isn't used.) The size control uses the same helper.
- Disabled (with the size control) where `editor.can().setFontFamily(...)` /
  `setFontSize(...)` is false, i.e. in code blocks and inline code.
- Clicking opens a popover rendered in a portal on `document.body` with `position: fixed` under
  the button (the toolbar scrolls horizontally, which would clip an absolutely positioned child).
  It contains: a search box (focused on open), category chips (All, Sans Serif, Serif, Display,
  Handwriting, Monospace), a `Default` row (`unsetFontFamily()`), then every matching family as a
  row (`role="listbox"` / `role="option"`, `aria-selected` on the current font).
- Each row renders its name in its own font. Previews load lazily: an `IntersectionObserver` calls
  `loadPreview` when a row scrolls into view.
- Search is a case-insensitive substring match on the family name, combined with the category.
  `Loading fonts…` shows until the catalog import resolves.
- The search box is a `role="combobox"` with `aria-controls` the listbox and
  `aria-activedescendant` the highlighted option (each option has a stable id). On open the
  highlight is the current font; a search highlights its first match.
- Keyboard: ↑/↓ move the highlight (scrolled into view), Enter applies it (ignored while an IME is
  composing, and a no-op when the search matches nothing), Esc closes and returns focus to the
  editor. Clicking a row applies it. Rows and category chips cancel `mousedown`, so focus stays in
  the search box. Clicking outside the popover, resizing the window, or scrolling anything outside
  the popover (the toolbar scrolls sideways) closes it.
- Applying runs `loadFont(family)` and `editor.chain().focus().setFontFamily(stack).run()`, then
  closes. The editor keeps its selection while the popover has focus, so the font lands on the
  text that was selected.

**Font size** (`FontSizeControl.tsx`), after the font picker, Google Docs–style: a `−` button, a
small number input, a `+` button. Units are points (`pt`).

- The input shows the size at the selection start: the `textStyle` `fontSize` if set, otherwise
  the computed CSS font size of the text at the cursor converted to points (px × 0.75, rounded),
  so headings show their real size (e.g. Heading 1 → 24).
- A stored `fontSize` in `pt` or `px` is converted to points; other units (e.g. `em` from pasted
  HTML) fall back to the computed size. The shown number is rounded for display only.
- The input (`type="text"`, `inputmode="numeric"`) keeps what the user types as a draft (in a ref,
  since blur can fire in the same tick as Enter/Escape). Only a typed draft is applied: Enter
  applies `setFontSize("<n>pt")` and returns focus to the editor; leaving the input applies it
  without refocusing; Esc discards it. Merely focusing and leaving the input changes nothing.
  `−`/`+` apply the shown size −1 / +1 and follow the toolbar button focus rules; they're
  disabled at 1 and 400. Sizes are whole numbers clamped to 1–400; non-numeric input reverts.
- Labels: `aria-label="Decrease font size"`, `"Font size"`, `"Increase font size"`.

**Privacy.** Because fonts are linked from Google (the user's choice over self-hosting), a browser
showing the picker or a note that uses a Google Font requests CSS from fonts.googleapis.com and
font files from fonts.gstatic.com. The app works without internet; text falls back to the generic
family.

Out of scope: weights other than regular/bold, uploading fonts, a per-note default font, line
height, colors.

## Branding

The app is **Lab Notes**: browser tab title, the list heading, and the "← Lab Notes" back link.
`web/public/logo.svg` is a blue (`#0b57d0`) document with a light-blue (`#8ab4f8`) folded corner
and a white lab flask with light-blue liquid. It is the favicon, the 36px logo beside the list
heading, and the 22px logo in the top bar's back link.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `5555` | Port the server listens on (bound to `0.0.0.0`). In dev, the Vite proxy targets it too. |
| `DATA_DIR` | `./data` | Directory holding `notes.db` |

Empty values count as unset. A `PORT` that is not an integer from 1 to 65535 exits at startup with
one clear error line.

**Logging:** Fastify's logger is on (startup, errors), but per-request logging is disabled, so the
container's logs don't grow with every request.

Under Compose, `PORT` is the **host** port only; the container always listens on 5555.

## Docker

`Dockerfile`, multi-stage:

1. **build** (`node:26-slim`): `WORKDIR /app`; copy `package.json` + `package-lock.json`;
   `npm ci`; `COPY . .`; `npm run build` (→ `/app/dist/web`).
2. **runtime** (`node:26-slim`): `WORKDIR /app`; `ENV NODE_ENV=production DATA_DIR=/data`; copy
   `package.json` + `package-lock.json`; `npm ci --omit=dev && npm cache clean --force`;
   `COPY server ./server` (`.dockerignore` excludes `server/**/*.test.ts`);
   `COPY --from=build /app/dist/web ./dist/web`; `mkdir /data && chown node:node /data`;
   `USER node`; `EXPOSE 5555`; `CMD ["node", "server/index.ts"]` (exec form, so Node is PID 1 and
   receives signals).

**Shutdown:** on `SIGTERM`/`SIGINT`, `index.ts` awaits `app.close()` (whose `onClose` hook closes
the database), then exits: code 0, or 1 with the error logged if closing failed. Fastify 5's default `forceCloseConnections: "idle"` keeps idle keep-alive
sockets from delaying this.

`compose.yaml`:

```yaml
name: lab-notes

services:
  app:
    build: .
    ports:
      - "${PORT:-5555}:5555"
    volumes:
      - data:/data
    restart: unless-stopped

volumes:
  data:
```

A fresh named volume copies `/data`'s ownership from the image, so the non-root `node` user can
write to it (a bind mount would not).

## Scripts

| Script | Does |
|---|---|
| `npm run dev:server` | `node --watch server/index.ts` |
| `npm run dev:web` | `vite` (proxies `/api` to the server's `PORT`) |
| `npm run build` | `vite build` |
| `npm run typecheck` | `tsc -p tsconfig.web.json && tsc -p tsconfig.server.json` |
| `npm test` | `node --test server/` |
| `npm start` | `node server/index.ts` (serves `dist/web` if present) |
| `npm run fonts:update` | Regenerates `web/src/google-fonts.json` from Google Fonts metadata |

Tests build the app with `dbPath: ":memory:"` and no `staticDir`, and `close()` it afterwards;
they never touch `./data`.

## Acceptance criteria

1. `docker compose up -d --build` starts the app on `http://<host>:5555`.
2. The list shows "No notes yet" on a fresh install.
3. "New note" → type text → Save creates a note; the URL becomes `/notes/<id>` and the editor keeps
   its content and cursor. A second Save updates the same note (no duplicate).
4. Back on the list, the note appears, titled with its first line; first line blank → `Untitled`.
5. Opening a note shows Save disabled; editing enables it; Save persists; reloading shows the saved
   content.
6. Unsaved edits are not persisted (no autosave).
7. Notes survive `docker compose down && docker compose up -d`.
8. `npm run typecheck` and `npm test` pass.
9. API errors are `{ error }` JSON; `POST /anything`, unknown `/api/*`, and missing files are
   JSON 404s.
10. Toolbar: each control applies its formatting to the selection, shows pressed state where the
    cursor is, keeps focus in the editor, and enables Save; Undo/Redo are disabled when there is
    nothing to undo/redo; the block-style select reflects and changes the current block.
11. Fonts: the picker searches/filters all Google Fonts with live previews; choosing one applies
    it to the selection and loads it; reopening the note (or reloading) shows the text in that
    font. Font size shows the size at the cursor, and −, +, and typed sizes change it.
