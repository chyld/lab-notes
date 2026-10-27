# Notes MVP — Spec

A self-hosted notes app (the start of a Google Docs–style app) for a homelab. It has two screens:
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

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 26 (`node:26-slim` image) | Built-in `node:sqlite` and native TypeScript type stripping: no build step and no native modules on the server. |
| Server | Fastify 5 + `@fastify/static` | Small, fast, JSON-schema validation, `inject()` for tests. |
| Database | SQLite via `node:sqlite` (`DatabaseSync`), WAL mode | One file, zero ops, ideal for a homelab. |
| Frontend | React 19 + Vite 8 + TypeScript | Tiptap's first-class binding is React. |
| Editor | `@tiptap/react` + `@tiptap/pm` + `@tiptap/starter-kit` (v3) | StarterKit defaults, unmodified. |
| Routing | `react-router` 7 (library mode) | Two routes. |
| Styling | One plain CSS file | No UI framework. |
| Tests | `node:test` (built in) | Server title logic and API. |

## Project layout

Single `package.json` at the repo root. Frontend libraries are `devDependencies` (they are bundled by
Vite at build time); server libraries are `dependencies`, so `npm ci --omit=dev` yields a small runtime.

```
compose.yaml
Dockerfile
.dockerignore
.gitignore
package.json
package-lock.json
tsconfig.server.json        # server: nodenext, erasableSyntaxOnly, allowImportingTsExtensions, noEmit
tsconfig.web.json           # web: bundler resolution, react-jsx, DOM libs, noEmit
vite.config.ts              # root: web/, outDir: dist/web, dev proxy /api -> server
server/
  index.ts                  # entry: reads env, starts app, handles SIGTERM/SIGINT
  app.ts                    # buildApp({ dbPath, staticDir? }) -> Fastify instance
  db.ts                     # open DB, PRAGMAs, schema, prepared statements
  title.ts                  # extractTitle(doc) -> string
  title.test.ts
  app.test.ts
web/
  index.html
  src/
    main.tsx                # router setup
    api.ts                  # typed fetch helpers
    NotesList.tsx           # route "/"
    NoteEditor.tsx          # route "/notes/:id" (id may be "new")
    styles.css
```

## Data model

```sql
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,   -- crypto.randomUUID()
  title      TEXT NOT NULL,      -- derived from content on every save
  content    TEXT NOT NULL,      -- Tiptap JSON (JSON.stringify of editor.getJSON())
  created_at TEXT NOT NULL,      -- ISO 8601 UTC
  updated_at TEXT NOT NULL       -- ISO 8601 UTC
);
```

On open: `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;`. The DB file is
`$DATA_DIR/notes.db` (`DATA_DIR` defaults to `./data`, created if missing).

## Title rule

The title is computed **on the server** from the saved Tiptap JSON, so it is always consistent with
the content:

1. Walk the document depth-first, in order. The first node whose type is a textblock
   (`paragraph`, `heading`, `codeBlock`) is the **first line**. Non-text blocks before it
   (e.g. `horizontalRule`) are skipped; container blocks (`bulletList`, `orderedList`, `listItem`,
   `blockquote`) are descended into.
2. Concatenate that node's `text` children in order, stopping at the first `hardBreak` node
   (and, for any text, at the first `\n`, which covers code blocks).
3. Collapse runs of whitespace to one space, trim, and cap at 200 characters.
4. If the result is empty (empty first line, or no textblock at all), the title is `Untitled`.

So a note whose first line is blank is `Untitled`, even if later lines have text. That matches
"the title is the first line".

## API

All under `/api`, JSON in and out. Errors return `{ "error": string }` with a 4xx/5xx status.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/notes` | — | `200` `[{ id, title, updatedAt }]`, sorted `updated_at DESC, id ASC` |
| `POST` | `/api/notes` | `{ content: Doc }` | `201` `Note` |
| `GET` | `/api/notes/:id` | — | `200` `Note`, or `404` |
| `PUT` | `/api/notes/:id` | `{ content: Doc }` | `200` `Note`, or `404` |

`Note` = `{ id, title, content, createdAt, updatedAt }` where `content` is the parsed Tiptap JSON.

`Doc` is validated with a Fastify JSON schema: an object with `type: "doc"` and an optional
`content` array (extra properties allowed; Tiptap nodes are not deeply validated in the MVP).
Invalid bodies get `400`. Fastify's default 1 MiB body limit applies; an oversized save returns
`413` and the editor shows the error.

`POST` and `PUT` set `title` from the title rule, and set `updated_at` (and `created_at` on
create) to the current time.

## Static serving

In production the server also serves the built frontend from `dist/web` with `@fastify/static`.
Any `GET` that is not under `/api` and does not match a file returns `index.html` (SPA fallback).
Unknown `/api/*` routes return a JSON `404`.

## Frontend

### `/` — Notes list

- Heading "Notes" and a "New note" button that navigates to `/notes/new`.
- The list of notes from `GET /api/notes`, each a link to `/notes/:id` showing its title.
  Long titles are truncated with an ellipsis in CSS.
- States: loading, error (message), empty ("No notes yet").

### `/notes/:id` — Note editor

- Top bar: a "← Notes" link back to the list, and a **Save** button.
- Below: the Tiptap editor (`useEditor` with `extensions: [StarterKit]`), styled as a centered
  white page on a gray background, Google Docs–like.
- **Loading an existing note**: `GET /api/notes/:id`, then mount the editor with that content.
  States: loading, not found ("Note not found" + link back), error.
- **New note** (`id === "new"`): mount the editor empty, with focus. The first Save does
  `POST /api/notes`, then `navigate("/notes/<newId>", { replace: true })`, **without** remounting
  the editor or refetching the note it just created. Nothing is persisted until Save is clicked,
  so opening "New note" and leaving creates nothing.
- **Save button**:
  - Disabled when there are no unsaved changes, and while a save is in flight.
  - Unsaved changes are tracked with a change counter bumped on every editor `update` event. A
    save records the counter value when it starts; on success the note is clean only if the
    counter has not moved since (edits typed during a save stay unsaved).
  - Sends `editor.getJSON()` (`PUT` for an existing note, `POST` for a new one).
  - Shows "Saving…" while in flight and an error message if the save fails. On failure the
    content stays in the editor and Save is enabled again.
- Formatting comes from StarterKit's built-in keyboard shortcuts and Markdown-style input rules
  (e.g. `# ` for a heading, `- ` for a list, `Ctrl+B` for bold). No toolbar.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Directory holding `notes.db` |

## Docker

`Dockerfile`, multi-stage:

1. **build** (`node:26-slim`): `npm ci`, copy source, `npm run build` (Vite → `dist/web`).
2. **runtime** (`node:26-slim`): `NODE_ENV=production`, `DATA_DIR=/data`; `npm ci --omit=dev`;
   copy `server/` and `dist/web`; create `/data` owned by `node`; `USER node`; `EXPOSE 3000`;
   `CMD ["node", "server/index.ts"]`. Test files are not copied.

The server closes Fastify and the database on `SIGTERM`/`SIGINT`, so `docker compose down` stops it
promptly and cleanly.

`compose.yaml`:

```yaml
services:
  notes:
    build: .
    ports:
      - "${PORT:-3000}:3000"
    volumes:
      - notes-data:/data
    restart: unless-stopped

volumes:
  notes-data:
```

A named volume (not a bind mount) avoids host file-permission problems with the non-root user.

## Scripts

| Script | Does |
|---|---|
| `npm run dev:server` | `node --watch server/index.ts` (port from `PORT`, default 3000) |
| `npm run dev:web` | Vite dev server; proxies `/api` to `http://localhost:${API_PORT:-3000}` |
| `npm run build` | `vite build` |
| `npm run typecheck` | `tsc -p tsconfig.web.json && tsc -p tsconfig.server.json` |
| `npm test` | `node --test server/` |
| `npm start` | `node server/index.ts` (serves `dist/web` if present) |

## Acceptance criteria

1. `docker compose up -d --build` starts the app on `http://<host>:3000`.
2. The list shows "No notes yet" on a fresh install.
3. "New note" → type text → Save creates a note; the URL becomes `/notes/<id>` and the editor keeps
   its content and cursor.
4. Back on the list, the note appears, titled with its first line; first-line blank → `Untitled`.
5. Editing an existing note enables Save; Save persists; reloading the page shows the saved content.
6. Unsaved edits are not persisted (no autosave).
7. Notes survive `docker compose down && docker compose up -d`.
8. `npm run typecheck` and `npm test` pass.
