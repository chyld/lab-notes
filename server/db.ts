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
  `);

  const list = db.prepare("SELECT id, title FROM notes ORDER BY updated_at DESC, id ASC");
  const get = db.prepare("SELECT * FROM notes WHERE id = ?");
  const insert = db.prepare(
    "INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const update = db.prepare("UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?");

  return {
    listNotes: () => list.all() as NoteListRow[],
    getNote: (id: string) => get.get(id) as NoteRow | undefined,
    insertNote: (row: NoteRow) => {
      insert.run(row.id, row.title, row.content, row.created_at, row.updated_at);
    },
    /** Returns false when no note has this id. */
    updateNote: (id: string, title: string, content: string, updatedAt: string) =>
      update.run(title, content, updatedAt, id).changes > 0,
    close: () => db.close(),
  };
}
