import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type NoteRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type NoteListRow = Pick<NoteRow, "id" | "title">;

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
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS images (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      data       BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // rowid breaks ties between saves in the same millisecond (latest insert first).
  const list = db.prepare("SELECT id, title FROM notes ORDER BY updated_at DESC, rowid DESC");
  const get = db.prepare("SELECT * FROM notes WHERE id = ?");
  const insert = db.prepare(
    "INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const update = db.prepare("UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?");
  // Ids are content hashes, so an existing row already holds these exact bytes.
  const insertImage = db.prepare("INSERT OR IGNORE INTO images (id, type, data, created_at) VALUES (?, ?, ?, ?)");
  const getImage = db.prepare("SELECT * FROM images WHERE id = ?");

  return {
    listNotes: () => list.all() as NoteListRow[],
    getNote: (id: string) => get.get(id) as NoteRow | undefined,
    insertNote: (row: NoteRow) => {
      insert.run(row.id, row.title, row.content, row.created_at, row.updated_at);
    },
    /** Returns false when no note has this id. */
    updateNote: (id: string, title: string, content: string, updatedAt: string) =>
      update.run(title, content, updatedAt, id).changes > 0,
    insertImage: (row: ImageRow) => {
      insertImage.run(row.id, row.type, row.data, row.created_at);
    },
    getImage: (id: string) => getImage.get(id) as ImageRow | undefined,
    close: () => db.close(),
  };
}
