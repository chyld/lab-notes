# Lab Notes — Spec

**Lab Notes** is a self-hosted notes app (the start of a Google Docs–style app) for a homelab. It has a notes sidebar
and a note editor. The editor engine is [Tiptap](https://tiptap.dev/).

## Scope

In scope, and nothing else:

1. **Notes sidebar**: every note by title (and tags), with a "New note" button. It replaced the
   original list page (user request). See [Notes sidebar](#notes-sidebar).
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
10. **Collapsible sidebar** (added by user request): the notes sidebar can be hidden and shown;
    clicking a note opens it for editing. See [Notes sidebar](#notes-sidebar).
11. **Tags** (added by user request): each note has tags (lowercase `a-z` and `0-9` only, no
    spaces), edited in a row above the text and saved with Save; the sidebar shows them. See
    [Tags](#tags).
12. **Search** (added by user request): one search box in the sidebar; words search the full text
    of every note, `#tag` filters by tag (prefix). See [Search](#search).
13. **Unsaved-changes warning** (added by user request): leaving a note with unsaved changes asks
    first. See [Unsaved changes](#unsaved-changes).
14. **Favorite fonts** (added by user request): star fonts in the font picker; they're kept on the
    server and pinned at the top of the list. See [Favorite fonts](#favorite-fonts).

Out of scope (the user will decide later): delete, autosave, keyboard
save shortcut, folders, sharing, auth, real-time collaboration,
version history, note previews in the sidebar, text color, an image button or file picker,
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
| Routing | `react-router@^8`, declarative mode (`BrowserRouter`, `Routes`, `Route`) | One layout route (sidebar) with `/`, `/notes/:id`, and a catch-all "Page not found". |
| Types | `typescript@^7`, `@types/node@^26`, `@types/react@^19`, `@types/react-dom@^19` | `npm run typecheck`. |
| Styling | One plain CSS file, built on CSS custom properties (see [Look](#look)) | No UI framework. |
| UI font | `@fontsource-variable/inter@^5` (devDependency; bundled by Vite, served by the app) | Inter for the interface and the editor's default text; works offline, no request to Google. |
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
  title.ts                  # extractTitle(doc), extractText(doc) (plain text for search)
  search.ts                 # parseQuery(q), matchesQuery(note, query)
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
    Layout.tsx              # route layout: sidebar + the routed screen (Outlet), "/" empty state
    NotePage.tsx            # route "/notes/:id" (id may be "new"): loading
    NoteEditor.tsx          # the Tiptap editor and Save
    Toolbar.tsx             # formatting toolbar for the editor
    ToolButton.tsx          # shared toolbar icon button + divider
    FontPicker.tsx          # Google Fonts browser (toolbar control)
    FontSizeControl.tsx     # − [size] + (toolbar control)
    HighlightPicker.tsx     # highlighter button + 8-color palette (toolbar control)
    popover.ts              # shared popover positioning and dismissal (font picker, highlight)
    fonts.ts                # catalog loading, Google Fonts <link> loading, font-family values
    favoriteFonts.ts        # favorite fonts: cached list + one ordered request queue
    google-fonts.json       # generated catalog: [family, category][] by popularity
    highlights.ts           # the 8 highlight colors
    imagePaste.ts           # paste-to-upload plugin with an "Uploading image…" placeholder
    LineNumbers.tsx         # line-number gutter: measures visual lines, renders the numbers
    Sidebar.tsx             # collapsible notes sidebar + its open/closed state (context)
    TagEditor.tsx           # the note's tag row (chips + add-tag input)
    tags.ts                 # tag rule shared by the UI: normalizeTag(), MAX_TAGS
    TopBar.tsx              # "Lab Notes" bar (+ Show notes button) shared by every screen
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
  updated_at TEXT NOT NULL,      -- ISO 8601 UTC
  tags       TEXT NOT NULL DEFAULT '[]', -- JSON array of tag strings, in the order added
  body       TEXT NOT NULL DEFAULT ''    -- the note's plain text, for search (see Search)
);
```

**Migration:** databases created before tags have no `tags` column. `openDb` checks
`PRAGMA table_info(notes)` and, if it's missing, runs
`ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`, so existing notes get no tags and
nothing else changes. Likewise for `body`: if it's missing, `ALTER TABLE notes ADD COLUMN body TEXT
NOT NULL DEFAULT ''` and every existing note's `body` filled from its parsed `content` with
`extractText`, all in one transaction (SQLite DDL is transactional: a crash mid-way leaves no
column, so the next start retries). A row whose `content` won't parse gets `''` instead of
aborting the upgrade. `updated_at` is not touched.

```sql
CREATE TABLE IF NOT EXISTS favorite_fonts (
  family   TEXT PRIMARY KEY,     -- a Google Fonts family name, e.g. "Open Sans"
  added_at TEXT NOT NULL         -- ISO 8601 UTC; favorites list in the order added
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
unless `path` is `":memory:"`, opens `DatabaseSync`, runs `PRAGMA journal_mode = WAL;`, creates
the tables, and runs the migrations: `tags` first, then `body`. (`favorite_fonts` is new, so
`CREATE TABLE IF NOT EXISTS` is all an existing database needs.) The DB file is `$DATA_DIR/notes.db` (`DATA_DIR` defaults to `./data`). WAL mode puts
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
| `GET` | `/api/notes?q=` | — | `200` `[{ id, title, tags, updatedAt }]` (only notes matching `q`, if given; see [Search](#search)), most recently saved first (`updated_at DESC, rowid DESC`: saves in the same millisecond list latest-inserted first) |
| `POST` | `/api/notes` | `{ content: Doc, tags?: string[] }` | `201` `Note` |
| `GET` | `/api/notes/:id` | — | `200` `Note`, or `404` |
| `PUT` | `/api/notes/:id` | `{ content: Doc, tags?: string[] }` | `200` `Note`, or `404` |
| `GET` | `/api/favorite-fonts` | — | `200` `["Lobster", …]`, in the order added |
| `PUT` | `/api/favorite-fonts/:family` | — | `204` (adds it; already a favorite → also `204`) |
| `DELETE` | `/api/favorite-fonts/:family` | — | `204` (removes it; not a favorite → also `204`) |
| `POST` | `/api/images` | raw image bytes | `201` `{ url }` |
| `GET` | `/api/images/:id` | — | `200` the image bytes, or `404` |

`Note` = `{ id, title, content, tags, createdAt, updatedAt }` where `content` is the parsed Tiptap
JSON and `tags` the note's tags in the order added.

**Body:** `POST`/`PUT` also set `body` = `extractText(content)` (`title.ts`): the text of every
text node in document order, a `\n` after each textblock and for each hard break; images and
rules add nothing. Like `extractTitle` it walks with an explicit stack and never throws. `body` is
only for search; no response includes it.

**Search:** `GET /api/notes?q=…` (querystring schema: `q` a string of at most 500 characters,
else 400). `q` is split on whitespace. A token starting with `#` is a tag prefix: lowercased,
everything but `a-z0-9` dropped, cut to 40 characters like a tag (so the sidebar's chips read it
the same way); a note matches if one of its tags starts
with it. Any other token is a word: a note matches if its `body` contains it (the body starts
with the title line, so titles are searched too; the `Untitled` placeholder is not text and never
matches), case-insensitively (both sides `toLowerCase()`), anywhere (substring, so `prox` matches
`Proxmox`; both sides NFC-normalized, so accents typed or pasted either way match). A tag token
that is empty after cleaning (`#`, `#!!`) is ignored. A note must match every token (AND). A blank `q` (or none) lists every note. Results
keep the list order (most recently saved first). Word searches read every note's `body`; tag-only searches use the plain list. Matching runs in JavaScript over the rows (`server/search.ts`:
`parseQuery`, `matchesQuery`), which is plenty fast for a homelab's notes and handles non-ASCII
case properly (SQLite's `LIKE` only folds ASCII).

**Favorite fonts:** `:family` (URL-encoded; `Open%20Sans`) must be at most 100 characters of
letters and digits in words separated by single spaces (`^[A-Za-z0-9]+( [A-Za-z0-9]+)*$`; every
Google Fonts family is), else `400`. The router's `maxParamLength` is raised to 300 (it counts the
still-encoded length, and `%20` is three characters); a param past that is refused by the router
before validation, `414 { error }` (URI Too Long). At most 200 favorites: a `PUT` of a new one
past that → `400 { error: "Too many favorite fonts" }`. Both writes are idempotent; re-adding keeps
a favorite's place. Listed `ORDER BY added_at, rowid` (rowid breaks a same-millisecond tie). Not
part of any note; no Save involved.

**Tags:** `tags` is optional. On `POST`, absent means `[]`; on `PUT`, absent leaves the note's tags
unchanged (the app always sends them). Schema: an array of at most 50 unique strings
(`uniqueItems`), each matching `^[a-z0-9]+$` and 1–40 characters. Anything else (uppercase,
spaces, `-`, empty, duplicates, too many, not an array) → `400`. The server stores them as given.

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

Typed helpers: `listNotes(q?)` (`?q=` URL-encoded, omitted when blank), `listFavoriteFonts()`,
`addFavoriteFont(family)`, `removeFavoriteFont(family)`, `getNote(id)`, `createNote(content, tags)`, `updateNote(id, content, tags)`,
`uploadImage(file)`. The favorite-font writes send no body (so no `Content-Type`) and resolve to
`void` on `204` (`send` doesn't parse an empty `204`). Note POST/PUT send `Content-Type: application/json`; `uploadImage` sends the
file's bytes with `Content-Type: file.type` and returns the `url`. A non-2xx response throws an `ApiError` carrying
`status` and the server's `error` message.

### Routes and layout (`Layout.tsx`)

The original list page is gone (user request). Every screen shares one layout route:

```tsx
<Route element={<Layout />}>
  <Route index element={<NoNoteOpen />} />        {/* "/" */}
  <Route path="notes/:id" element={<NotePage />} />
  <Route path="*" element={<PageNotFound />} />
</Route>
```

`Layout` renders the [sidebar](#notes-sidebar) beside an `<Outlet />`, so the sidebar is one
instance for the whole app: it never remounts when you switch notes or go to `/`.

- `/` shows the top bar (Show notes button while the sidebar is hidden, the "Lab Notes" brand) and
  a muted message: "Pick a note, or create a new one." Nothing else.
- Unknown client routes show the top bar and "Page not found."

### `/notes/:id` — Note page (`NotePage.tsx`)

Two components: **`NotePage`** (route element, owns loading) and **`NoteEditor`** (owns the Tiptap
instance and saving).

`NotePage`:

- Top bar: the Show notes button while the [sidebar](#notes-sidebar) is hidden, the "Lab Notes"
  brand (logo + name) linking to `/`, and a save error message when there is one (rendered by
  `NoteEditor`). The Save button itself is the first icon of the [toolbar](#toolbar).
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
- **Save button:** a floppy-disk icon button (lucide `Save`, `aria-label`/`title` "Save") at the
  start of the toolbar (user request; it used to be a text button in the top bar). `NoteEditor`
  passes `canSave` (dirty and not saving), `saving`, and `onSave` to `Toolbar`. Disabled when not
  dirty or while saving. An in-flight promise ref, set
  synchronously when a save starts, also guards `save()` (the `saving` state only disables the
  button after React re-renders): a second `save()` while one runs returns that same promise, so
  two clicks in one tick never both `POST` (duplicate note), and the leave dialog can wait for it.
  `save()` resolves to whether it worked; a `savedVersionRef` mirrors `savedVersion` so "dirty
  right now" can be read from refs. Its label and tooltip read "Saving…" while in flight. Like the other toolbar buttons it cancels
  `mousedown`, so clicking it keeps focus (and the selection) in the editor; a tag typed in the tag
  input but not yet added is still saved, because `save()` adds it first. A
  failure shows the `ApiError` message and re-enables Save; the content stays in the editor. Sends
  `editor.getJSON()`.
- **Leaving mid-save:** a `mountedRef` (set in an effect, cleared on cleanup) guards every
  post-await state update and the `onCreated` call, so a save that finishes after the user left
  completes its database write but changes nothing on screen.
- The editor spans the full width of its column (the window, minus the sidebar while it shows) (user request; it replaced the centered, Google
  Docs–style page): white, text inset 3rem left/right (1.25rem under 816px wide; the left inset
  grows while [line numbers](#line-numbers) show), and at least as tall as the window below the
  header, so clicking anywhere under the text focuses it.
- Browser spell check is off in the editor (user request): `editorProps.attributes.spellcheck =
  "false"` on the contenteditable, so no red squiggles.
- Paragraphs have no spacing between them (user request): Enter starts the next line directly
  below, the same height as a wrapped line; for space, the user adds a blank line. This includes
  paragraphs inside list items and quotes. Headings, lists, quotes, and code blocks keep their
  margins.
- Unmatched client routes render the top bar and "Page not found." (see [Routes](#routes-and-layout-layouttsx)).
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
| Save | Save (disk icon) |
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
  rows and is the only sticky element in the note column (the [sidebar](#notes-sidebar) beside it
  sticks on its own).
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
  `RemoveFormatting`, `Highlighter`, `Hash` (line numbers), `Save`.
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
  row (`role="listbox"` / `role="option"`, `aria-selected` on the current font; with
  [favorites](#favorite-fonts) pinned, on its first row only).
- Each row renders its name in its own font. Previews load lazily: an `IntersectionObserver` calls
  `loadPreview` when a row scrolls into view.
- Search is a case-insensitive substring match on the family name, combined with the category.
  `Loading fonts…` shows until the catalog import resolves.
- The search box is a `role="combobox"` with `aria-controls` the listbox and
  `aria-activedescendant` the highlighted option (each option has a stable id). On open the
  highlight is the current font; a search highlights its first match. (With favorites, see
  [Favorite fonts](#favorite-fonts).)
- Keyboard (in the search box): ↑/↓ move the highlight (scrolled into view; hovering moves it
  too but doesn't scroll), Enter applies it (ignored while an IME is composing, while the catalog
  is still loading, and when the search matches nothing). Esc anywhere in the popover closes it and
  returns focus to the editor; Enter on a category chip just toggles the chip. Clicking a row
  applies it. Rows and chips cancel `mousedown`, so focus stays in the search box. Clicking outside
  the popover, focus leaving it (e.g. Tab past the list), resizing the window, or an element outside
  it scrolling (the toolbar scrolls sideways; page scrolls are ignored since the header is sticky)
  closes it. If the catalog chunk fails to load, the popover says so and the next open retries.
- Rows are memoized, so moving the highlight (or starring a font) re-renders a couple of rows, not
  ~1,700: every row prop is stable (its key-based id, booleans, shared callbacks), none an index.
- Favorites: see [Favorite fonts](#favorite-fonts).
- Applying runs `loadFont(family)` and sets the font via `setTextStyle` (`editor.ts`), then closes.
  `setTextStyle` exists because, at a collapsed cursor, Tiptap's `setMark` merges in the
  surrounding text's attributes even after Clear formatting emptied the stored marks (a cleared
  font would come back on the next size change). At a cursor it sets every textStyle attribute
  explicitly (from `textStyleAt`, the rest `null`); for a range it uses Tiptap's per-segment merge,
  so changing the size of text in two fonts keeps both fonts. Font size applies the same way. The editor keeps its selection while the popover has focus, so the font lands on the
  text that was selected.

**Favorite fonts** (user request: "a way to save my favorite fonts so that they're easy to
access"). Kept on the server (`favorite_fonts`, API above), so every device and browser shows the
same favorites; a preference, not note content, so a star click saves at once (no Save button).
State and the request queue live in `favoriteFonts.ts`; `FontPicker.tsx` renders them.

- **Loading:** each time the picker opens it fetches `listFavoriteFonts()` (through the queue
  below, so it sees any write still in flight). Meanwhile it shows the last list it had (a
  module-level cache, empty on the first open), so an unchanged list doesn't jump. Stars and the
  shortcut stay off until that fetch answers: before then the picker doesn't know what's starred.
  If it fails they stay off and the cached group (if any) still shows; trying to toggle then says
  "Couldn't load favorites. Close the font list and try again." (`role="alert"`).
- **Order of rows:** `Default` first, as before. Then, when any favorite matches the current
  search and category, a "Favorites" group (catalog families only, in the order added), then an
  "All fonts" group with every match as before (favorites appear there too, in their usual place).
  With no matching favorite there are no groups or headings: the list is exactly as before.
- **Markup** (the APG grouped-listbox pattern): the listbox is a `div`; each group is a
  `ul role="group"` labelled (`aria-labelledby`) by its first child, a small uppercase heading
  `li role="presentation"`; without groups, one `ul role="presentation"`. Loading/empty/error
  messages render below the listbox, not inside it. Row identity is the group plus the family
  (`default`, `fav:Lobster`, `all:Lobster`), used for React keys and option ids (spaces become
  `-`, which is unambiguous since families never contain `-`). Both copies of the current font
  show the current-font color; only the first has `aria-selected`.
- **Stars:** each font row ends with a lucide `Star` (16px): filled `--favorite` (`#d97706`, 3:1
  on white) for a favorite, otherwise an outline shown only on the highlighted or hovered row, and
  always (faint) on touch screens (`@media (hover: none)`). The star is a decorative, mouse/touch
  target (`aria-hidden`, a `span`, no tab stop), since an option's contents aren't exposed to
  screen readers. Clicking it toggles the favorite and doesn't apply the font; like the row, it
  cancels `mousedown` so focus stays in the search box. Its `title` (only once stars respond):
  "Add to favorites (Ctrl+D)" / "Remove from favorites (Ctrl+D)" (⌘D on macOS). A favorite's option name ends in ", favorite"
  (visually hidden text), and the search box has `aria-keyshortcuts`.
- **Keyboard:** Ctrl+D (⌘D on macOS: exactly that modifier, no Shift or Alt; ignored on key repeat
  and while an IME is composing) anywhere in the popover (the search box or a focused chip)
  toggles the highlighted font, with `preventDefault` so the browser doesn't bookmark the page.
  The D key is matched by its letter, or by its position (`code` `KeyD`) when the layout doesn't
  type Latin letters (Cyrillic, Greek). Nothing on `Default`.
- **Announcements:** a visually hidden `role="status"` says "Added Lobster to favorites" /
  "Removed Lobster from favorites".
- **Highlight:** tracked by row identity, not index (↑/↓ walk the flat list of options in display
  order, skipping headings). It's set when the catalog loads, on every search or category change,
  and again when the favorites fetch settles (unless ↑/↓ have moved it since):
  - no search, Favorites group showing: the current font's Favorites row if it's a favorite, else
    `Default`; the list opens at the top, favorites in view;
  - no search, no group: the current font's row, else `Default` (as before);
  - a search: its first match (a favorite, if one matches).

  Toggling never moves it: starring keeps it on the same row (the new Favorites row isn't
  highlighted); unstarring the highlighted Favorites row moves it to that font's All fonts row
  (scrolled into view only for Ctrl+D, where the keyboard user needs to see it).
- **Toggling** updates the list at once (optimistic, and the cache) and queues
  `addFavoriteFont` / `removeFavoriteFont`. All favorites requests run one at a time, in order
  (one module-level queue that outlives the popover), so a quick star-unstar can't reach the
  server reversed. If a write fails and it was that font's latest toggle, the popover shows
  "Couldn't update favorites: <server message>" (`role="alert"`) below the list until the next
  toggle, and refetches the list to match the server (ignored if anything was toggled meanwhile);
  if that fetch fails too, just that font's change is undone (a removed favorite goes back before
  the first of its old successors still listed). Writes finish even if the popover closes.
- **Other devices:** the server keeps the last write it receives; another device's changes show
  the next time the picker opens.

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
  the note without the pending images; inserting them makes the note dirty again (so leaving
  before saving again gets the [unsaved-changes](#unsaved-changes) warning). Images still uploading
  when the user leaves are not inserted anywhere.

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

### Notes sidebar

`Sidebar.tsx`. A left bar on every screen (`/`, `/notes/:id` including `new`, loading, not-found,
and error states) with a New note button and every note; clicking a note opens it in the editor.

- **Layout:** `Layout` owns the sidebar state (`useSidebarState`) and the refresh counter, reads
  the open note's id with `useParams()` (a layout route sees its child's params; `null` on `/`),
  and renders one `<div className="note-layout">` = the sidebar + a `.note-main` (made `inert`
  behind the narrow overlay) column holding the `<Outlet />` (top bar, toolbar, editor or status), so the sidebar is a single
  instance that never remounts. The sidebar (`<nav id="notes-sidebar" aria-label="Notes">`) stays
  mounted while hidden (`hidden` attribute), keeping its list, scroll position, and the
  `aria-controls` target. It is 260px wide, light gray (`#f8f9fa`) with a right border,
  `position: sticky; top: 0; align-self: flex-start; height: 100dvh` with its own vertical scroll,
  so it stays put while the note scrolls. `.note-main` is `flex: 1; min-width: 0` (the toolbar
  keeps scrolling sideways; its scrollbar is `thin`, since beside the sidebar it overflows on
  ~1280px windows). No ancestor sets `overflow`, so the editor header stays sticky. Line numbers
  re-measure on their own when the sidebar changes the editor's width (`ResizeObserver`).
- **Header:** the label "Notes" and the hide button, then a full-width "New note" button (`Plus`
  icon + text; a `<Link>`) that navigates to `/notes/new`. If an unsaved new note is already open,
  it stays as it is (same route; the link uses `replace` there, so no duplicate history entry).
- **Search box** under New note: see [Search](#search).
- **Notes:** most recently saved first (`listNotes()`), each an `<li>` with a link
  (`<Link to="/notes/:id">`, full title in `title`) holding two lines: the title (truncated with an
  ellipsis) and, under it in small gray text, when the note was last saved (user request) as a
  `<time dateTime={updatedAt}>` with the full date and time in its `title`. The label uses the
  browser's locale and time zone (`Intl.DateTimeFormat`): "Edited today, 3:42 PM", "Edited
  yesterday, 9:10 AM", "Edited Oct 12, 3:42 PM" (earlier this year), "Edited Oct 12, 2025"
  (older). "Today"/"yesterday" are judged when the list renders (every refetch). Then, if the note
  has tags, a wrapping row of small tag chips under it. Each chip is a `<button>` (`#tag`,
  `aria-pressed` when the search contains the token `#tag`, `title="Search for #tag"`); clicking it
  adds `#tag` to the search, or removes it if it's there. Chips sit beside the link, not inside it
  (no interactive content inside a link). The open note's link has `aria-current="page"` and a
  light blue background.
- **States:** "Loading…" (first load only), "No notes yet", or the error message (first load only;
  a failed refresh keeps the list already shown).
- **Freshness:** `NoteEditor` gets an `onSaved()` callback, called after every successful save
  (PUT or the first POST, after `onCreated`'s navigation so the new note is highlighted). Unlike
  `onCreated` it is not guarded by `mountedRef`: a save that finishes after the user switched notes
  still refreshes the list. `Layout` provides `notesChanged` in the sidebar context and
  `NotePage` reads it with `useNotesChanged()` as its `onSaved`; it bumps a counter
  and the sidebar refetches, so a new note appears and renamed/re-tagged/re-saved notes update and
  move to the top. Switching notes also refetches (so a failed first load is retried). While
  refetching, the previous list stays shown; the effect's cleanup cancels a superseded request,
  so an older response never overwrites a newer list.
- **Switching notes:** clicking a note, New note, or the brand navigates; with unsaved changes it
  asks first (see [Unsaved changes](#unsaved-changes)). Clicking the note that's already open
  changes nothing.
- **Collapse:** the sidebar header's button (`PanelLeftClose` icon, `aria-label="Hide notes"`)
  hides it; while hidden, the top bar shows a button at its far left (`PanelLeftOpen`,
  `aria-label="Show notes"`) that shows it. Both are `.tool`-style icon buttons with
  `aria-expanded` and `aria-controls="notes-sidebar"`; since each replaces the other, focus moves
  to the one now shown. The state is shared through a small React context in `Sidebar.tsx`,
  provided by `Layout`, read by `TopBar` (with no provider, the Show button renders nothing).
- **Remembered:** on wide screens the open/closed choice is stored in
  `localStorage["lab-notes:sidebar"]` (`"open"`/`"closed"`, default open; unavailable storage
  just means not remembered).
- **Narrow screens** (`matchMedia("(max-width: 816px)")`, the same breakpoint as the CSS, with a
  `change` listener): the sidebar would crowd out the editor, so it has its own session-only state
  that starts closed (never stored; only the wide-screen choice is written to `localStorage`).
  Crossing the breakpoint switches to that width's state. It opens as an overlay (`position:
  fixed`, `z-index: 30` over a translucent backdrop at 29, so above the sticky header and the
  popovers at 10, with a shadow), makes `.note-main` `inert` while open (no tabbing into the
  editor underneath), and closes on a backdrop click or Esc (a `document` keydown listener while
  the overlay is open, so it works wherever focus is; both return focus to Show notes) or on
  picking a note or New note. Clicking a tag chip (it edits the search) leaves it open.

Out of scope: reordering, delete, renaming a tag across notes.

### Search

One search box in the sidebar (user request), under New note: a `type="search"` input with a
magnifier icon (`aria-hidden`), `aria-label="Search notes"`, placeholder `Search, or #tag`,
`spellcheck=false`, `autocapitalize=off`, `maxLength=500` (the server's limit).

- **What it matches:** the server does the matching (`GET /api/notes?q=`, see API): plain words
  search the full text of every note (its body, which includes the title line; substring,
  case-insensitive), `#tag` tokens
  match notes with a tag starting with what's typed (`#home` → `homelab`, `home`), and every token
  must match. So `proxmox #homelab` lists notes tagged `homelab…` that mention proxmox.
- **Tag chips** in the list toggle their `#tag` token in the box: clicking adds it (keeping what's
  already typed), clicking again removes it. Tokens are compared as the search reads them, so
  `#Home` counts as `#home` (pressed, and removed with every duplicate). A click that would make
  the search longer than 500 characters does nothing. This replaced the separate tag filter.
- **Requests:** typing waits 200ms after the last keystroke, then fetches `listNotes(q)`; the
  sidebar also re-runs the search when the list refreshes (after a save, or switching notes). A
  superseded request's answer is ignored (effect cleanup), so an older response never overwrites a
  newer one. Until the first answer for a non-blank box the full list shows; after that, while a
  search is in flight, the previous results stay. A failed search keeps them but says
  "Couldn't search: …" (`role="alert"`) until a search succeeds or the box is cleared. (The
  request is built inside the promise chain, so even a query that can't be URL-encoded, like a
  lone surrogate from a broken paste, is shown this way.) Clearing
  the box shows the full list at once (no debounce).
- **Showing results:** the sidebar keeps the full list (as before) and the set of matching ids;
  while the box is non-blank it lists the full list's notes that matched, in the same order, plus
  the open note whether or not it matched (so you always see where you are, e.g. a new note you
  just saved while searching). If nothing matched, it says "No notes match" (`role="status"`),
  even while the open note is listed below it, but only while the box still holds the query that
  answer is for (not while the next search is on its way). Blank box → the full list.
- **Esc** in a non-empty box clears it (handled by the input itself, not left to the browser, and
  not while an IME is composing); the key stops there, so on narrow screens it doesn't also close
  the overlay. Esc in an empty box closes the narrow overlay as before. The overlay's own Esc
  handler ignores an Esc that cancels an IME composition.
- The search is the sidebar's own state (the sidebar never remounts): it survives switching
  notes, but not a reload.

Out of scope: highlighting matches, result snippets, ranking, search syntax beyond words and
`#tag` (no quotes, OR, or negation).

### Tags

A note's tags are labels made of lowercase letters and digits only (`a-z`, `0-9`; no spaces or
other characters), 1–40 characters, at most 50 per note, unique within the note, kept in the order
added. They are part of the note: saved by the Save button with the content (no autosave), never
in the document JSON.

- **Tag row** (`TagEditor.tsx`): a row at the top of the note area, above the text (inside
  `.page-wrap`, so it scrolls with the note; not in the sticky header), aligned with the text's
  left edge (the same left padding as the text: 3rem, 4.5rem with line numbers, 1.25rem/3rem
  under 816px). It shows the note's tags as chips (`#tag` and a × button,
  `aria-label="Remove tag tag"`; removing moves focus to the input) followed by a small input
  (`aria-label="Add tag"`, placeholder `add tag`, `spellcheck=false`, `autocapitalize=off`; no
  `maxLength`, since it would cut a paste before normalizing).
- **Typing:** a space or comma ends a tag. This is checked on every change of the input's value,
  not only on keydown (phone keyboards often don't report those keys), so pasting
  `Home Lab, ZFS` adds `home` and `lab` and leaves `zfs` typed. The typed part keeps only allowed
  characters: uppercase becomes lowercase, anything else is dropped. Enter (and Space/comma on
  keydown, which are prevented from reaching the input) adds the typed tag; leaving the input
  (blur) adds it too. An empty input adds nothing; a tag the note already has, or a 51st tag, is
  not added (the input clears). Focus stays in the input after adding by keyboard.
- **Dirty and Save:** adding or removing a tag bumps the editor's one version counter (the same
  one document changes bump, see Dirty tracking), so Save lights up and a tag change made during
  a save stays unsaved. Text typed in the tag input but not yet added also counts as unsaved
  (Save is enabled), and Save adds it first, so a typed tag is never lost by clicking Save. The
  editor owns the typed text (`draft`) and keeps tags and draft in refs, which is what a save
  reads.
- **Saving:** Save sends `tags` with the content (`createNote(content, tags)` /
  `updateNote(id, content, tags)`); the tags captured at the start of the save are what's saved.
  After saving, the sidebar refreshes and shows the new tags.
- **Line numbers** measure only the editor's text, so the tag row gets no number. The gutter's
  `ResizeObserver` also watches the tag row, so when it wraps onto another line (moving the text
  down without resizing the editor) the numbers follow.
- **Look:** chips are small rounded pills (`#e9eef6` background, `#444746` text, 13px); the × is a
  small icon button. The sidebar's chips use the same style at 12px; a chip whose `#tag` is in
  the search is light blue (`#d3e3fd`, `#0b57d0`).
- `tags.ts` holds the rule for the UI: `normalizeTag(text)` (lowercase, strip disallowed
  characters, cut to 40), `MAX_TAG_LENGTH = 40`, and `MAX_TAGS = 50`. The server validates
  independently (see API; `coerceTypes: false`, so `tags: "foo"` is a 400, not `["foo"]`).

### Unsaved changes

By user request: if the open note has unsaved changes (the editor is dirty: content or tags
changed since the last save, or a tag is typed in the tag input but not added) and the user tries
to leave it, the app warns first.

- **In-app navigation** (a note in the sidebar, New note, the brand, the browser's Back/Forward):
  `NoteEditor` blocks it with react-router's `useBlocker`. (This needs a data router, so
  `main.tsx` uses `createBrowserRouter(createRoutesFromElements(…))` + `<RouterProvider>` instead
  of `<BrowserRouter>`; the routes are unchanged.) The blocker fires only when dirty, the path
  changes, and the destination isn't this same note's own URL (the new note → `/notes/<id>` step
  after its first save is not leaving). The dirty flag is read from a ref, so the check is never
  stale.
- **The dialog** (`UnsavedDialog.tsx`): a modal `<dialog>` (`showModal()`, in a portal on
  `document.body`, so it's never inside the inert column behind the narrow overlay) titled
  "Unsaved changes": "“<title>” has changes you haven't saved. Save them before you go?" (the live
  title from the breadcrumb). Three buttons:
  - **Keep editing** (quiet; focused first, so a stray Enter stays; Esc does the same) → stay:
    nothing changes.
  - **Don't save** (red text) → proceed: the edits are discarded.
  - **Save** (the gradient button; "Saving…" while in flight) → `save({ stay: false })`; if a save
    was already running (a toolbar Save just before the click away) that one is awaited. Changes
    that arrive after a save's snapshot (made during a toolbar save, or an image upload landing
    mid-save) are saved in further rounds (up to 3). Then proceed only if it worked and nothing is
    unsaved; otherwise stay (a failure shows its error in the top bar). If it stays on a note that
    was just created by this Save (so its `/notes/<id>` URL change was skipped), it makes that URL
    change now (`onCreated`), keeping the page, the URL, and the own-URL exemption in agreement. `stay: false` skips the new note → `/notes/<id>` URL
    change, since the page is leaving anyway; the sidebar still refreshes (`onSaved`).
  - While any save runs, all three buttons are disabled and Esc does nothing: the save's outcome
    decides. A save that finishes while the dialog is open and leaves nothing unsaved (e.g. that
    toolbar Save) simply proceeds.
  - Every answer goes through one `settle(go)`: it reads the latest blocker from a ref and answers
    only once per blocked navigation (react-router rejects a second `proceed`/`reset`).
  - Keep editing gets focus explicitly when the dialog opens; after Keep editing or Esc the editor
    gets focus back. On narrow screens the sidebar overlay's Esc handler stands aside while a modal
    dialog is open, so Esc reaches the dialog.
- **Reload or closing the tab** while dirty: a `beforeunload` listener (registered only while
  dirty) calls `preventDefault()`, so the browser shows its own "Leave site?" prompt (browsers
  don't allow custom text there).
- Look: white card, 16px corners, large soft shadow, a blurred translucent backdrop.

## Branding

The app is **Lab Notes**: browser tab title and the top bar's brand link to `/`.
`web/public/logo.svg` is a document filled with the brand gradient (indigo `#6366f1` → violet
`#a855f7` → pink `#ec4899`, top-left to bottom-right), a translucent white folded corner, and a
white lab flask with violet (`#c084fc`) liquid. It is the favicon, the 24px logo in the top bar's
brand link, and the 56px logo on `/`. `apple-touch-icon.png` is it at 140px centered on a 180px
white square (`rsvg-convert` + ImageMagick).

## Look

A UI refresh by user request: "modern and colorful, but also elegant and sleek and maybe
minimalistic", with a nicer nav bar. `styles.css` defines the tokens once, on `:root`, and every
rule uses them; where other sections of this spec name older colors (Google blue `#0b57d0`,
`#d3e3fd`, `#5f6368`, …) the token in the same role applies.

| Token | Value | Role |
|---|---|---|
| `--ink` / `--ink-2` / `--muted` | `#16161d` / `#45455a` / `#6b6b80` | text, secondary text, hints (≥ 4.8:1 on white and the canvas) |
| `--canvas` / `--surface` / `--hover` | `#f6f6fb` / `#fff` / `#f3f2f9` | app background and sidebar, cards and the editor, hover fill |
| `--line` / `--line-strong` | `#e8e8f0` / `#d6d6e2` | borders, dividers |
| `--accent` / `--accent-ink` | `#6d4aff` / `#4f2fd6` | the one accent: focus, pressed, links, Save with changes |
| `--accent-soft` / `--accent-softer` | `#efeaff` / `#f7f5ff` | pressed and selected fills, inline code |
| `--gradient` | `#6366f1 → #a855f7 → #ec4899` | decoration only: the 3px line along the top edge, the open note's left bar |
| `--gradient-strong` | `#4f46e5 → #7c3aed → #c026d3` | behind white text (New note): every stop keeps white ≥ 4.5:1 |
| radii / shadows / focus | 12px, 8px; soft layered shadows; `0 0 0 3px` accent at 28% | |

- **Type:** Inter (variable, bundled) everywhere, including the editor's default text; headings
  700 with tight tracking; tabular numbers for the font size and line numbers.
- **Nav bar** (the top bar): frosted white (`backdrop-filter: blur`), a 3px gradient line along
  the very top of the window, the gradient logo and "Lab Notes" in semibold, then on a note a
  breadcrumb: a light `/` and the open note's title (`--ink-2`, truncated with an ellipsis, full
  title on hover). The title is live: `liveTitle(editor)` (`editor.ts`) applies the same title
  rule as the server to the editor's document on every change, so it follows the first line as
  you type ("Untitled" when blank). Status screens and `/` show no breadcrumb.
- **Toolbar:** a floating white bar (rounded 12px, border, soft shadow) under the top bar, inside
  the same frosted header. 28px icon buttons with 8px corners, `--ink-2` icons, `--hover` on hover,
  `--accent-soft`/`--accent-ink` when pressed, faded when disabled. Save (`.tool-save`) is in the
  accent color while there's something to save. Spacing is tight enough that the whole bar fits
  beside the sidebar on a 1280px window.
- **Sidebar:** the canvas color with a hairline border; "NOTES" as a small uppercase label; New
  note as a full-width gradient button with a soft violet glow (lifts 1px on hover); the search
  box as a white field that gets an accent ring on focus. Notes are rounded rows; hover fills
  `--hover`; the open note is a white card with a soft shadow, a gradient bar on its left edge,
  and its title in `--accent-ink`.
- **Tags:** every tag gets one of 8 soft colors, the same everywhere and every time: `tagHue(tag)`
  (`tags.ts`) hashes the name to `data-hue` 0–7, and CSS maps each to a background and ink
  (violet, blue, cyan, green, amber, orange, pink, rose; every ink ≥ 5.2:1 on its background). A
  sidebar chip whose `#tag` is in the search is filled with its ink color, white text.
- **Editor content:** links in `--accent-ink` with a soft underline; quotes with a light violet
  left border; inline code on `--accent-softer` in `--accent-ink`; code blocks dark (`#17161f`
  background, `#e7e5f4` text, 12px corners); images with slightly rounded corners and round accent
  resize handles; the caret in the accent color.
- **Popovers** (fonts, highlight): white, 14px corners, a large soft shadow; the font search is a
  filled field; category chips are pills.
- **`/` (no note open):** the 56px logo with a soft violet glow and the "Pick a note, or create a
  new one." message, centered.
- No dark mode (not requested).

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
2. On a fresh install, `/` shows the sidebar with "No notes yet" and "Pick a note, or create a new
   one."
3. The sidebar's "New note" → type text → Save creates a note; the URL becomes `/notes/<id>` and the editor keeps
   its content and cursor. A second Save updates the same note (no duplicate).
4. The note appears in the sidebar, titled with its first line; first line blank → `Untitled`.
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
15. Sidebar: every screen shows a left bar with a New note button and every note (most recent
    first, the open note highlighted, tags under titles); clicking a note opens it; saving updates the list; Hide/Show collapses and
    restores it, remembered on wide screens; on narrow screens it's an overlay that closes after
    picking a note.
16. Tags: typing in the tag row accepts only `a-z0-9` (uppercase lowercased, others dropped);
    Enter/Space/comma/blur adds a tag, × removes one, both enable Save; Save persists them and the
    sidebar shows them; clicking a tag chip in the sidebar adds `#tag` to the search and
    clicking it again removes it; the API rejects invalid tags with 400; an
    existing database gains the `tags` column with every note untagged.
17. Search: typing words in the sidebar's search box lists the notes whose text contains every
    word (case-insensitive substring), plus the open note even if it doesn't match; `#tag` narrows to notes with a tag starting with it;
    both combine; blank shows everything; "No notes match" when nothing does; existing notes are
    searchable right after the upgrade (`body` backfilled); `npm test` covers parsing, matching,
    the 500-character limit, and the backfill.
18. Unsaved changes: with unsaved edits (or tags, or a typed tag), clicking another note, New note,
    the brand, or Back opens the dialog; Keep editing/Esc stays with the edits; Don't save leaves
    without saving; Save saves and then leaves (a new note is created); a failed save stays with
    the error; saving with the toolbar (including a new note's first save) never asks; reloading
    or closing the tab while dirty gets the browser's prompt; a clean note never asks.
19. Favorite fonts: the star on a font row (or Ctrl+D on the highlighted row) adds it to Favorites,
    which appear pinned at the top of the picker under `Default` (filtered by search and category),
    in the order added; the picker opens with them in view; starring again removes it; favorites persist across reloads and devices (server);
    applying a font from the Favorites group works like any row; the API validates family names
    and caps favorites at 200; `npm test` covers the API.
