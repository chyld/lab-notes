# Lab Notes — Spec

**Lab Notes** is a self-hosted notes app (the start of a Google Docs–style app) for a homelab. It has two screens:
a list of notes and a note editor. The editor engine is [Tiptap](https://tiptap.dev/).

## Scope

In scope, and nothing else:

1. **Notes list**: shows every note by title, with a "New note" button.
2. **Note editor**: edits one note in Tiptap and saves it **only when the Save button is clicked**.
3. **Title**: the note's title is its **first line**.
4. **Packaging**: one Docker image, run with Docker Compose, data on a persistent volume.

Out of scope (the user will decide later): delete, autosave, unsaved-changes warnings, keyboard
save shortcut, formatting toolbar, search, folders, sharing, auth, real-time collaboration,
version history, dates or previews in the list, images/uploads.

## Stack

| Layer | Choice (pinned major) | Why |
|---|---|---|
| Runtime | Node 26 (`node:26-slim` image) | Built-in `node:sqlite` and native TypeScript type stripping: no server build step, no native modules. |
| Server | `fastify@^5`, `@fastify/static@^10` | Small, fast, JSON-schema validation, `inject()` for tests. |
| Database | SQLite via `node:sqlite` (`DatabaseSync`), WAL mode | One file, zero ops. |
| Frontend | `react@^19`, `react-dom@^19`, `vite@^8`, `@vitejs/plugin-react@^6` | Tiptap's first-class binding is React. |
| Editor | `@tiptap/react@^3`, `@tiptap/pm@^3`, `@tiptap/starter-kit@^3` | StarterKit defaults, unmodified. |
| Routing | `react-router@^8`, declarative mode (`BrowserRouter`, `Routes`, `Route`) | Two routes, plus a catch-all "Page not found". |
| Types | `typescript@^7`, `@types/node@^26`, `@types/react@^19`, `@types/react-dom@^19` | `npm run typecheck`. |
| Styling | One plain CSS file | No UI framework. |
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
- Formatting comes from StarterKit's keyboard shortcuts and Markdown-style input rules (`# `
  heading, `- ` list, `Ctrl+B` bold). No toolbar.

StarterKit v3 defaults include `Link` (autolinks pasted/typed URLs), `Underline`, `ListKeymap`,
and `TrailingNode` (keeps an empty paragraph at the end of the document, so saved JSON often ends
with one). These are expected.

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
