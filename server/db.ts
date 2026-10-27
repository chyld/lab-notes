import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { extractText } from "./title.ts";

export type NoteRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  /** JSON array of tag strings. */
  tags: string;
  /** Plain text of the content, for search. */
  body: string;
};

export type NoteListRow = Pick<NoteRow, "id" | "title" | "tags" | "updated_at">;
export type NoteSearchRow = NoteListRow & Pick<NoteRow, "body">;

export type ImageRow = {
  id: string;
  type: string;
  data: Uint8Array;
  created_at: string;
};

export type Db = ReturnType<typeof openDb>;

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tags       TEXT NOT NULL DEFAULT '[]',
      body       TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS favorite_fonts (
      family   TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS images (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      data       BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Databases from before tags: add the column; existing notes get no tags.
  const columns = db.prepare("PRAGMA table_info(notes)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "tags")) {
    db.exec("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  }
  // Databases from before search: add the column and fill it from every note's content, in one
  // transaction, so old notes are searchable at once.
  if (!columns.some((column) => column.name === "body")) {
    db.exec("BEGIN");
    try {
      db.exec("ALTER TABLE notes ADD COLUMN body TEXT NOT NULL DEFAULT ''");
      const fill = db.prepare("UPDATE notes SET body = ? WHERE id = ?");
      for (const row of db.prepare("SELECT id, content FROM notes").all() as { id: string; content: string }[]) {
        let body = "";
        try {
          body = extractText(JSON.parse(row.content));
        } catch {
          // unparseable content: nothing to search
        }
        fill.run(body, row.id);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // rowid breaks ties between saves in the same millisecond (latest insert first).
  const list = db.prepare("SELECT id, title, tags, updated_at FROM notes ORDER BY updated_at DESC, rowid DESC");
  const searchable = db.prepare(
    "SELECT id, title, tags, updated_at, body FROM notes ORDER BY updated_at DESC, rowid DESC",
  );
  const get = db.prepare("SELECT * FROM notes WHERE id = ?");
  const insert = db.prepare(
    "INSERT INTO notes (id, title, content, created_at, updated_at, tags, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  // A null tags parameter keeps the note's tags.
  const update = db.prepare(
    "UPDATE notes SET title = ?, content = ?, body = ?, tags = COALESCE(?, tags), updated_at = ? WHERE id = ?",
  );
  // Ids are content hashes, so an existing row already holds these exact bytes.
  const insertImage = db.prepare("INSERT OR IGNORE INTO images (id, type, data, created_at) VALUES (?, ?, ?, ?)");
  const getImage = db.prepare("SELECT * FROM images WHERE id = ?");
  // rowid breaks ties between favorites added in the same millisecond.
  const listFavorites = db.prepare("SELECT family FROM favorite_fonts ORDER BY added_at, rowid");
  const isFavorite = db.prepare("SELECT 1 FROM favorite_fonts WHERE family = ?");
  const countFavorites = db.prepare("SELECT COUNT(*) AS count FROM favorite_fonts");
  const insertFavorite = db.prepare("INSERT OR IGNORE INTO favorite_fonts (family, added_at) VALUES (?, ?)");
  const deleteFavorite = db.prepare("DELETE FROM favorite_fonts WHERE family = ?");

  return {
    listNotes: () => list.all() as NoteListRow[],
    /** Every note with its plain text, in list order, for search. */
    searchableNotes: () => searchable.all() as NoteSearchRow[],
    getNote: (id: string) => get.get(id) as NoteRow | undefined,
    insertNote: (row: NoteRow) => {
      insert.run(row.id, row.title, row.content, row.created_at, row.updated_at, row.tags, row.body);
    },
    /** Returns false when no note has this id. `tags` null keeps the note's tags. */
    updateNote: (id: string, title: string, content: string, body: string, tags: string | null, updatedAt: string) =>
      update.run(title, content, body, tags, updatedAt, id).changes > 0,
    insertImage: (row: ImageRow) => {
      insertImage.run(row.id, row.type, row.data, row.created_at);
    },
    getImage: (id: string) => getImage.get(id) as ImageRow | undefined,
    /** Favorite font families, in the order added. */
    listFavoriteFonts: () => (listFavorites.all() as { family: string }[]).map((row) => row.family),
    isFavoriteFont: (family: string) => isFavorite.get(family) !== undefined,
    countFavoriteFonts: () => (countFavorites.get() as { count: number }).count,
    /** Already a favorite: keeps its place in the order. */
    addFavoriteFont: (family: string, addedAt: string) => {
      insertFavorite.run(family, addedAt);
    },
    removeFavoriteFont: (family: string) => {
      deleteFavorite.run(family);
    },
    close: () => db.close(),
  };
}
