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
7. **Highlighter** (added by user request): highlight text in one of 8 colors. See
   [Highlight](#highlight).
8. **Images** (added by user request): paste images into a note and resize them. See
   [Images](#images).
9. **Line numbers** (added by user request): a gutter numbering every visual line, toggled from
   the toolbar. See [Line numbers](#line-numbers).

Out of scope (the user will decide later): delete, autosave, unsaved-changes warnings, keyboard
save shortcut, search, folders, sharing, auth, real-time collaboration,
version history, dates or previews in the list, text color, an image button or file picker,
image drag-and-drop from outside the browser, image captions/alignment/cropping/alt text, and
deleting unused images.

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
| Highlight | `@tiptap/extension-highlight@^3` (`multicolor: true`) | Highlighter colors. |
| Images | `@tiptap/extension-image@^3` (its built-in `resize` node view) | Pasted, resizable images. |
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
  images.ts                 # image size limit, accepted content types, type detection
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
    HighlightPicker.tsx     # highlighter button + 8-color palette (toolbar control)
    popover.ts              # shared popover positioning and dismissal (font picker, highlight)
    fonts.ts                # catalog loading, Google Fonts <link> loading, font-family values
    google-fonts.json       # generated catalog: [family, category][] by popularity
    highlights.ts           # the 8 highlight colors
    imagePaste.ts           # paste-to-upload plugin with an "Uploading image…" placeholder
    LineNumbers.tsx         # line-number gutter: measures visual lines, renders the numbers
    TopBar.tsx              # "← Lab Notes" bar shared by the note screens
    styles.css
scripts/
  update-google-fonts.ts    # regenerates web/src/google-fonts.json (npm run fonts:update)
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

```sql
CREATE TABLE IF NOT EXISTS images (
  id         TEXT PRIMARY KEY,   -- SHA-256 of the bytes, lowercase hex
  type       TEXT NOT NULL,      -- MIME type detected from the bytes
  data       BLOB NOT NULL,
  created_at TEXT NOT NULL       -- ISO 8601 UTC
);
```

Images are stored in the same database file, so `notes.db` stays the whole of the app's data.

`openDb(path)` creates the parent directory (`mkdirSync(dirname(path), { recursive: true })`)
unless `path` is `":memory:"`, opens `DatabaseSync`, runs `PRAGMA journal_mode = WAL;`, and creates
both tables. The DB file is `$DATA_DIR/notes.db` (`DATA_DIR` defaults to `./data`). WAL mode puts
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

All under `/api`, JSON in and out, except image bytes (below). Note POST/PUT require
`Content-Type: application/json`.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/notes` | — | `200` `[{ id, title }]`, most recently saved first (`updated_at DESC, rowid DESC`: saves in the same millisecond list latest-inserted first) |
| `POST` | `/api/notes` | `{ content: Doc }` | `201` `Note` |
| `GET` | `/api/notes/:id` | — | `200` `Note`, or `404` |
| `PUT` | `/api/notes/:id` | `{ content: Doc }` | `200` `Note`, or `404` |
| `POST` | `/api/images` | raw image bytes | `201` `{ url }` |
| `GET` | `/api/images/:id` | — | `200` the image bytes, or `404` |

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

**Images.**

- `POST /api/images` takes the raw bytes with any `image/*` `Content-Type` or
  `application/octet-stream`. Those parsers (`parseAs: "buffer"`) are registered in an
  encapsulated Fastify plugin with the route, so other routes still reject image bodies with 415.
  The route's `bodyLimit` is 25 MiB (`MAX_IMAGE_BYTES`); bigger → 413.
- The type is detected from the leading bytes (PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`,
  GIF `GIF87a`/`GIF89a`, WebP `RIFF????WEBP`), not taken from the header. Anything else →
  `415 { error: "Unsupported image type" }`; an empty body → `400 { error: "Image is empty" }`.
  SVG is never accepted (it can carry script).
- The id is the SHA-256 of the bytes; the row is inserted with `INSERT OR IGNORE`, so the same
  image pasted twice is stored once. Response: `201 { url: "/api/images/<id>" }`.
- `GET /api/images/:id`: an id that isn't 64 lowercase hex characters, or isn't stored →
  `404 { error: "Image not found" }`. Otherwise the bytes with `Content-Type` the stored type,
  `Cache-Control: public, max-age=31536000, immutable` (an id's bytes can never change), and
  `X-Content-Type-Options: nosniff`, and `Content-Security-Policy: default-src 'none'; style-src
  'unsafe-inline'; sandbox` (defense in depth if one is opened directly). `HEAD` works too
  (Fastify's automatic HEAD route).
- Nothing deletes images (there is no delete anywhere). An image pasted into a note that is never
  saved stays in the database unused. Like the rest of the app there is no auth, so anyone who can
  reach the port can upload; there is no total-size quota (accepted for a homelab).

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

Typed helpers: `listNotes()`, `getNote(id)`, `createNote(content)`, `updateNote(id, content)`,
`uploadImage(file)`. Note POST/PUT send `Content-Type: application/json`; `uploadImage` sends the
file's bytes with `Content-Type: file.type` and returns the `url`. A non-2xx response throws an `ApiError` carrying
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
- The editor spans the full window width (user request; it replaced the centered, Google
  Docs–style page): white, text inset 3rem left/right (1.25rem under 816px wide; the left inset
  grows while [line numbers](#line-numbers) show), and at least as tall as the window below the
  header, so clicking anywhere under the text focuses it.
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
| Marks | Bold, Italic, Underline, Strikethrough, Inline code, Highlight color |
| Link | Link |
| Lists | Bulleted list, Numbered list |
| Blocks | Quote, Code block, Horizontal line |
| Clear | Clear formatting |
| View | Line numbers (toggle) |

Nothing else: no text color, alignment, indent buttons, image button, tables, or anything
StarterKit and the extensions above don't include. StarterKit's shortcuts without a control (e.g. Shift+Enter
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
  `RemoveFormatting`, `Highlighter`, `Hash` (line numbers).
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
`[family, category]`, sorted by popularity (~1,740 entries: Google's ~1,950 families minus brand
fonts; categories: Sans Serif, Serif, Display, Handwriting, Monospace). `npm run fonts:update` regenerates it from
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
  `aria-haspopup="dialog"`, `aria-expanded`. "At the selection" is `textStyleAt(editor)`
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
- Keyboard (in the search box): ↑/↓ move the highlight (scrolled into view; hovering moves it
  too but doesn't scroll), Enter applies it (ignored while an IME is composing, while the catalog
  is still loading, and when the search matches nothing). Esc anywhere in the popover closes it and
  returns focus to the editor; Enter on a category chip just toggles the chip. Clicking a row
  applies it. Rows and chips cancel `mousedown`, so focus stays in the search box. Clicking outside
  the popover, focus leaving it (e.g. Tab past the list), resizing the window, or an element outside
  it scrolling (the toolbar scrolls sideways; page scrolls are ignored since the header is sticky)
  closes it. If the catalog chunk fails to load, the popover says so and the next open retries.
- Rows are memoized, so moving the highlight re-renders two rows, not ~1,700.
- Applying runs `loadFont(family)` and sets the font via `setTextStyle` (`editor.ts`), then closes.
  `setTextStyle` exists because, at a collapsed cursor, Tiptap's `setMark` merges in the
  surrounding text's attributes even after Clear formatting emptied the stored marks (a cleared
  font would come back on the next size change). At a cursor it sets every textStyle attribute
  explicitly (from `textStyleAt`, the rest `null`); for a range it uses Tiptap's per-segment merge,
  so changing the size of text in two fonts keeps both fonts. Font size applies the same way. The editor keeps its selection while the popover has focus, so the font lands on the
  text that was selected.

**Font size** (`FontSizeControl.tsx`), after the font picker, Google Docs–style: a `−` button, a
small number input, a `+` button. Units are points (`pt`).

- The input shows the size at the selection start: the `textStyle` `fontSize` if set, otherwise
  the computed CSS font size converted to points (px × 0.75, rounded), so headings show their real
  size (e.g. Heading 1 → 24). The measured element is the text before a cursor (what typing
  continues, via `domAtPos(pos, -1)`) or at the start of a range; after Clear formatting (explicit
  empty stored marks) it is the block, not the old span the cursor still sits in.
- A stored `fontSize` in `pt` or `px` is converted to points; other units (e.g. `em` from pasted
  HTML) fall back to the computed size. The shown number is rounded for display only.
- The input (`type="text"`, `inputmode="numeric"`) keeps what the user types as a draft (in a ref,
  since blur can fire in the same tick as Enter/Escape). Only a typed draft is applied: Enter
  applies `setFontSize("<n>pt")` and returns focus to the editor (Enter refocuses the editor even
  with nothing typed); leaving the input applies it without refocusing; Esc discards it. Merely
  focusing and leaving the input changes nothing. `−`/`+` step from a pending typed size if there
  is one (they cancel `mousedown`, so the input doesn't blur first), otherwise from the shown size,
  and follow the toolbar button focus rules; they're disabled at 1 and 400. Only plain whole
  numbers are accepted (`^\d+$`, so `1e3` or `0x10` revert), clamped to 1–400.
- Labels: `aria-label="Decrease font size"`, `"Font size"`, `"Increase font size"`.

**Privacy.** Because fonts are linked from Google (the user's choice over self-hosting), a browser
showing the picker or a note that uses a Google Font requests CSS from fonts.googleapis.com and
font files from fonts.gstatic.com. The app works without internet; text falls back to the generic
family.

Out of scope: weights other than regular/bold, uploading fonts, a per-note default font, line
height, colors.

### Highlight

**Extension.** `editor.ts` adds Tiptap's `Highlight` with `multicolor: true`. A highlight is a
`highlight` mark with a `color` attribute (normally a palette hex value), saved in the note's JSON
and rendered as `<mark data-color="#ffe967" style="background-color: #ffe967; color: inherit">`
(Tiptap drops invalid CSS values). Clear formatting removes it like any mark.

- `Ctrl+Shift+H` (⌘⇧H on macOS) toggles **Yellow**, judged by `markAt(editor, "highlight")`: on
  Yellow text, or a colorless highlight (which shows as Yellow), it runs `unsetHighlight()`;
  otherwise `setHighlight({ color: Yellow })`, so text highlighted another color switches to
  Yellow. The stock shortcut (`toggleHighlight()` with no color) is replaced because it merges in
  the color of the highlight around the cursor, even one just removed with None.
- The `==text==` input and paste rules are kept (like StarterKit's Markdown rules); they add a
  highlight with no color, which CSS shows as Yellow and the toolbar treats as Yellow.
- Pasted `<mark>`s keep their own color, even one outside the palette: the button's bar shows it
  and no swatch is pressed.

**Palette** (`highlights.ts`), in rainbow order:

| Name | Hex |
|---|---|
| Red | `#ffaba3` |
| Orange | `#ffc18a` |
| Yellow | `#ffe967` |
| Green | `#bbf7bc` |
| Cyan | `#88f3ff` |
| Blue | `#90c4ff` |
| Purple | `#d9baff` |
| Pink | `#ffb2d6` |

Why these: the hues are spread evenly around the color wheel (~45° apart, OKLCH hues 25° to 350°)
so each is a familiar, nameable color; all eight share one OKLCH chroma (0.10, Yellow 0.15 to
read as a highlighter) so none shouts over the others; each is as light as sRGB allows at that
chroma (OKLCH L ≤ 0.92) so the note's `#1f1f1f` text keeps at least 9:1 contrast on every color
(WCAG AAA asks 7:1). The closest pair (Red/Pink) is still 0.066 apart in OKLab, clearly distinct.
Some pairs (Blue/Purple) are hard to tell apart with red-green color blindness, which no 8-hue
palette avoids, so every swatch is also named (tooltip and `aria-label`).

**Highlight picker** (`HighlightPicker.tsx`), in the marks group after Inline code:

- A button with the `Highlighter` icon and a 3px bar under it in the highlight color at the
  selection (no bar when there's none; set as `background-color`, so a pasted color value can't
  load a `url()`). `aria-label="Highlight color"`, `title="Highlight color"`,
  `aria-haspopup="dialog"`, `aria-expanded`. Disabled where `editor.can().setHighlight()` is false
  (code blocks, inline code).
- "At the selection" uses `markAt(editor, "highlight")` (`editor.ts`), the same rules as
  `textStyleAt` (which becomes `markAt(editor, "textStyle")?.attrs ?? {}`): stored marks at a
  cursor (even an empty set after Clear formatting), else the marks there; for a range, the marks
  of its first inline node (so after Select All it reads the first text, not the first
  paragraph, which has no marks).
- Clicking opens a popover (`role="dialog"`, `aria-label="Highlight colors"`) under the button,
  positioned and dismissed exactly like the font picker's (`popover.ts`, shared): portal on
  `document.body`, `position: fixed`; closes on Esc (refocusing the editor), an outside click,
  focus leaving it, a window resize, or an outside element scrolling.
- It holds one row of 8 round swatch buttons (24px, in palette order; `aria-label` and `title` the
  color's name; `aria-pressed` on the current color) and a "None" button. On open, focus goes to
  the current color's swatch, or the first. Tab/Shift+Tab move between them; Enter/Space or a
  click applies. Applying runs `editor.chain().focus().setHighlight({ color }).run()`; None runs
  `unsetHighlight()`. Either closes the popover. At a cursor, like Bold, it applies to the text
  typed next.

### Images

**Extension.** `editor.ts` adds Tiptap's `Image` configured with `resize: { enabled: true,
directions: ["top-left", "top-right", "bottom-left", "bottom-right"], minWidth: 32, minHeight: 32,
alwaysPreserveAspectRatio: true }`. Its node view is wrapped so that every update reapplies
`width`/`height` to the `<img>`: Tiptap's resizable view only applies sizes it made itself, so
otherwise undoing or redoing a resize would leave the old size on screen. Images are block nodes (`inline: false`, the default), so an
image pasted mid-line splits the line. A node is `{ type: "image", attrs: { src, alt, title,
width, height } }`; `width`/`height` are pixels, `null` until resized. `allowBase64` stays false:
`data:` images in pasted HTML are dropped. The extension's `![alt](src)` input rule is kept. Images
have no text, so the title rule skips them.

**Paste** (`imagePaste.ts`, a Tiptap extension with one ProseMirror plugin):

- `handlePaste` takes over when the clipboard has `image/*` files and either has no `text/html` or
  the pasted slice has no text. So a screenshot or a browser's "Copy image" pastes
  the image file, while copying text and pictures together (a web page, a word processor, which
  also puts a PNG of the whole selection on the clipboard) pastes normally. In a code block it
  doesn't take over. Pasted HTML `<img>`s keep their URLs (Tiptap's default), so a web page's
  images are hotlinked (the same goes for HTML dragged in from another page).
- A file over 25 MiB is skipped with `alert("Images can be up to 25 MB.")` before uploading.
- The paste changes nothing yet: the plugin records the selection range and its content, and shows
  an "Uploading image…" placeholder (a widget decoration) at the range's end. The range is mapped
  through every edit made meanwhile (text typed at its edges stays outside it). It uploads the
  files (`uploadImage`, in parallel; types other than PNG/JPEG/GIF/WebP come back as 415
  "Unsupported image type").
- When all have settled, one transaction removes the placeholder and, if any upload succeeded, inserts the images in clipboard order with `replaceRangeWith` (which moves out
  of a paragraph's start/end, replaces an empty paragraph, and splits a line mid-way). The pasted-
  over selection is replaced only if its content is unchanged; if the user edited it meanwhile,
  the images go after it instead. If the selection is still the pasted range, the cursor ends up
  right after the images (a paragraph is added after them if no textblock follows), so typing
  continues below; otherwise the user's selection is left alone. Failed uploads are reported with
  `alert`; if every upload failed, the document is untouched. The insertion is its own undo step:
  `closeHistory` is set on it and on an empty transaction right after, so ProseMirror's history
  doesn't merge it with typing done within 500ms before or after. If the editor was destroyed
  meanwhile (the user left), nothing happens.
- The placeholder is a decoration, not content: it is never saved. A Save during an upload saves
  the note without the pending images; inserting them makes the note dirty again (leaving before
  saving again loses them, like any unsaved edit; unsaved-changes warnings are out of scope).

**Resize.** Clicking an image selects it (blue outline) and shows four corner handles; dragging one
resizes the image, keeping its aspect ratio, down to 32px. Releasing stores `width` and `height` on
the node (one undo step; marks the note dirty) and leaves the image selected; as with any selected
image, typing replaces it (undoable). Mouse only: the library's touch resizing never commits.

The library ships no handle styling and sets inline pixel `width` *and* `height`, so `styles.css`
supplies:

- `[data-resize-container]` and `[data-resize-wrapper]`: `max-width: 100%`.
- the `<img>`: `max-width: 100%; height: auto !important`. The `!important` beats the inline
  height, so the height always follows the width and the aspect ratio holds. A drag past the page
  edge is capped at the page width, and since the commit reads the rendered `offsetWidth`/
  `offsetHeight`, the capped, proportional size is what's stored. Unresized images show at natural
  size, capped the same way; on a narrower window a stored width is capped too.
- handles: 10px white squares with a blue border at the corners, diagonal resize cursors, shown on
  hover, while selected (`.ProseMirror-selectednode`), and while dragging; the selected image gets
  a 2px blue outline.

**Privacy (images).** Pasted image files are stored on the server and never leave the homelab. Hotlinked
images in pasted HTML are the exception: they load from their original site whenever the note is
opened, which tells that site the viewer's IP address.

### Line numbers

A view setting, not note content: it never changes the document, the JSON, or Save.

- **Toggle:** the last toolbar group (after Clear formatting, behind a divider) is one `Tool`
  button, `Hash` icon, `aria-label="Line numbers"`, `aria-pressed` when on, with the same focus
  rules as the other buttons. `NoteEditor` owns the on/off state (`useLineNumbersSetting` in
  `LineNumbers.tsx`) and passes it, with the toggle, to `Toolbar` and to the gutter. Off by default; the choice is remembered in
  this browser (`localStorage["lab-notes:line-numbers"]` = `"on"`/`"off"`; unavailable storage just
  means it isn't remembered) and applies to every note.
- **What's numbered:** every visual line of text, as laid out on screen, counted from 1 down the
  note: each wrapped line of a long paragraph, each line after a hard break, each line of a code
  block, an empty paragraph (one line). Headings, list items, and quotes count like paragraphs.
  Images and horizontal lines are not text lines and get no number (numbering continues after
  them). Nested content (lists, quotes) is numbered in document order.
- **Measuring** (`LineNumbers.tsx`): for each textblock in the document (`doc.descendants`,
  `node.isTextblock`, its DOM from `view.nodeDOM(pos)`), take `Range.selectNodeContents(dom)
  .getClientRects()`, drop zero-height rects (never zero-width ones: blank lines, hard-break lines,
  and empty code lines exist only as zero-width rects, e.g. ProseMirror's trailing `<br>`), sort by
  top, and merge a rect into the current line when they overlap vertically by more than half the
  shorter one (so a line mixing font sizes, or an inline element's box plus its text, is one line,
  while a box bleeding a pixel into the next line doesn't chain two lines). A textblock with no
  rects at all is one line spanning its content box.
  Coordinates are relative to the `<main className="page-wrap">` (now `position: relative`) that
  holds the editor and the gutter.
- **When:** measured when the gutter mounts, then re-measured (coalesced to one measurement per
  animation frame; a hidden tab measures when shown) on editor transactions except selection-only
  ones (typing, formatting, and the upload placeholder's meta-only transactions count; caret moves
  don't), when the editor element's content box resizes (`ResizeObserver`: window width, and the
  wider left padding when the gutter turns on), when web fonts finish loading (`document.fonts`
  `loadingdone`: Google Fonts change wrapping), and when an image in the editor loads or fails
  (`load`/`error`, captured, since either moves the lines below). The numbers re-render only when
  a line actually moved. While an image is being dragged to a new size the numbers
  below it may lag until the drag ends (the commit is a transaction).
- **Look:** a gutter in the editor's left margin; the left padding grows to 4.5rem (3rem under
  816px wide) while numbers show. Each number is right-aligned 1rem left of the text column,
  vertically centered on its line, 12px, `#5f6368`, `font-variant-numeric: tabular-nums`. The
  gutter is `aria-hidden`, `pointer-events: none`, and not selectable, so it never ends up in
  copied text and never steals clicks.

Out of scope: numbering only some lines, restarting per page/section, a numbering interval
(every 5th line), and printing.

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
12. Highlight: each of the 8 colors applies to the selection and None removes it; the button's bar
    shows the color at the cursor; Ctrl+Shift+H toggles Yellow; a saved, reloaded note keeps its
    highlights.
13. Images: pasting a screenshot inserts it at the cursor; a failed upload leaves the note
    unchanged; dragging a corner resizes it with the aspect ratio kept and never wider than the
    page; undo/redo of a resize updates the image; Save then reload shows it at the new size; it
    survives `docker compose down && docker compose up -d`; `npm test` covers upload, dedupe, type
    detection, 413/415/404, and the GET headers.
14. Line numbers: the toolbar toggle shows/hides a gutter numbering every visual line (wrapped
    lines, code lines, empty paragraphs; not images); the numbers follow typing, window resizes,
    font changes, and image loads; the setting survives a reload; it never marks the note dirty.
