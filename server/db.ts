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
  /** users.id; null only for notes saved before accounts existed, until the first account. */
  owner_id: string | null;
};

export type NoteListRow = Pick<NoteRow, "id" | "title" | "tags" | "updated_at">;
export type NoteSearchRow = NoteListRow & Pick<NoteRow, "body">;

export type ImageRow = {
  id: string;
  type: string;
  data: Uint8Array;
  created_at: string;
};

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
};

/** A session with the user it belongs to. */
export type SessionRow = {
  token_hash: string;
  user_id: string;
  username: string;
  last_seen_at: string;
};

export type AccountSummary = { username: string; created_at: string; notes: number };

export type Db = ReturnType<typeof openDb>;

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  // The server and the accounts command line share the file: a write that meets the other's lock
  // waits for it instead of failing at once.
  db.exec("PRAGMA busy_timeout = 5000;");
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
    CREATE TABLE IF NOT EXISTS user_favorite_fonts (
      user_id  TEXT NOT NULL,
      family   TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (user_id, family)
    );
    CREATE TABLE IF NOT EXISTS images (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      data       BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash   TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
    CREATE TABLE IF NOT EXISTS image_owners (
      image_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      PRIMARY KEY (image_id, user_id)
    );
  `);

  /** Runs `fn` in a `BEGIN IMMEDIATE` transaction (the write lock up front), rolling back on error. */
  function immediate<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // Migrations, all in one transaction that re-reads the columns inside it: the server and the
  // command line starting at the same moment can't both add a column.
  immediate(() => {
    const columns = db.prepare("PRAGMA table_info(notes)").all() as { name: string }[];
    const has = (name: string) => columns.some((column) => column.name === name);
    // Databases from before tags: add the column; existing notes get no tags.
    if (!has("tags")) db.exec("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
    // Databases from before search: add the column and fill it from every note's content, so old
    // notes are searchable at once.
    if (!has("body")) {
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
    }
    // Databases from before accounts: notes start with no owner, until the first account.
    if (!has("owner_id")) db.exec("ALTER TABLE notes ADD COLUMN owner_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS notes_owner ON notes (owner_id)");
  });

  // Every note statement is scoped to its owner, so another user's note is simply not found.
  // rowid breaks ties between saves in the same millisecond (latest insert first).
  const list = db.prepare(
    "SELECT id, title, tags, updated_at FROM notes WHERE owner_id = ? ORDER BY updated_at DESC, rowid DESC",
  );
  const searchable = db.prepare(
    "SELECT id, title, tags, updated_at, body FROM notes WHERE owner_id = ? ORDER BY updated_at DESC, rowid DESC",
  );
  const get = db.prepare("SELECT * FROM notes WHERE id = ? AND owner_id = ?");
  const insert = db.prepare(
    "INSERT INTO notes (id, title, content, created_at, updated_at, tags, body, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // A null tags parameter keeps the note's tags.
  const update = db.prepare(
    "UPDATE notes SET title = ?, content = ?, body = ?, tags = COALESCE(?, tags), updated_at = ? WHERE id = ? AND owner_id = ?",
  );

  // Ids are content hashes, so an existing row already holds these exact bytes.
  const insertImage = db.prepare("INSERT OR IGNORE INTO images (id, type, data, created_at) VALUES (?, ?, ?, ?)");
  const grantImage = db.prepare("INSERT OR IGNORE INTO image_owners (image_id, user_id) VALUES (?, ?)");
  const getImage = db.prepare(
    "SELECT images.* FROM images JOIN image_owners ON image_owners.image_id = images.id WHERE images.id = ? AND image_owners.user_id = ?",
  );

  // rowid breaks ties between favorites added in the same millisecond.
  const listFavorites = db.prepare(
    "SELECT family FROM user_favorite_fonts WHERE user_id = ? ORDER BY added_at, rowid",
  );
  const isFavorite = db.prepare("SELECT 1 FROM user_favorite_fonts WHERE user_id = ? AND family = ?");
  const countFavorites = db.prepare("SELECT COUNT(*) AS count FROM user_favorite_fonts WHERE user_id = ?");
  const insertFavorite = db.prepare(
    "INSERT OR IGNORE INTO user_favorite_fonts (user_id, family, added_at) VALUES (?, ?, ?)",
  );
  const deleteFavorite = db.prepare("DELETE FROM user_favorite_fonts WHERE user_id = ? AND family = ?");

  const countUsers = db.prepare("SELECT COUNT(*) AS count FROM users");
  const userByName = db.prepare("SELECT * FROM users WHERE username = ?");
  const insertUser = db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)");
  const setHash = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
  const accounts = db.prepare(
    `SELECT users.username, users.created_at, COUNT(notes.id) AS notes
       FROM users LEFT JOIN notes ON notes.owner_id = users.id
      GROUP BY users.id ORDER BY users.created_at, users.username`,
  );
  const countUnowned = db.prepare("SELECT COUNT(*) AS count FROM notes WHERE owner_id IS NULL");
  const claimNotes = db.prepare("UPDATE notes SET owner_id = ? WHERE owner_id IS NULL");
  const claimImages = db.prepare("INSERT OR IGNORE INTO image_owners (image_id, user_id) SELECT id, ? FROM images");
  const claimFavorites = db.prepare(
    "INSERT OR IGNORE INTO user_favorite_fonts (user_id, family, added_at) SELECT ?, family, added_at FROM favorite_fonts",
  );

  const insertSession = db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
  );
  const getSession = db.prepare(
    `SELECT sessions.token_hash, sessions.user_id, users.username, sessions.last_seen_at
       FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?`,
  );
  const touchSession = db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?");
  const deleteSession = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
  const deleteUserSessions = db.prepare("DELETE FROM sessions WHERE user_id = ?");
  const deleteExpired = db.prepare("DELETE FROM sessions WHERE last_seen_at < ?");

  return {
    immediate,

    listNotes: (ownerId: string) => list.all(ownerId) as NoteListRow[],
    /** Every one of the owner's notes with its plain text, in list order, for search. */
    searchableNotes: (ownerId: string) => searchable.all(ownerId) as NoteSearchRow[],
    getNote: (id: string, ownerId: string) => get.get(id, ownerId) as NoteRow | undefined,
    insertNote: (row: NoteRow & { owner_id: string }) => {
      insert.run(row.id, row.title, row.content, row.created_at, row.updated_at, row.tags, row.body, row.owner_id);
    },
    /** Returns false when the owner has no note with this id. `tags` null keeps the note's tags. */
    updateNote: (
      id: string,
      ownerId: string,
      title: string,
      content: string,
      body: string,
      tags: string | null,
      updatedAt: string,
    ) => update.run(title, content, body, tags, updatedAt, id, ownerId).changes > 0,

    /** Stores the bytes (once per content) and grants the image to the uploader. */
    insertImage: (row: ImageRow, userId: string) => {
      insertImage.run(row.id, row.type, row.data, row.created_at);
      grantImage.run(row.id, userId);
    },
    /** The image, if it's granted to this user. */
    getImage: (id: string, userId: string) => getImage.get(id, userId) as ImageRow | undefined,

    /** The user's favorite font families, in the order added. */
    listFavoriteFonts: (userId: string) =>
      (listFavorites.all(userId) as { family: string }[]).map((row) => row.family),
    isFavoriteFont: (userId: string, family: string) => isFavorite.get(userId, family) !== undefined,
    countFavoriteFonts: (userId: string) => (countFavorites.get(userId) as { count: number }).count,
    /** Already a favorite: keeps its place in the order. */
    addFavoriteFont: (userId: string, family: string, addedAt: string) => {
      insertFavorite.run(userId, family, addedAt);
    },
    removeFavoriteFont: (userId: string, family: string) => {
      deleteFavorite.run(userId, family);
    },

    countUsers: () => (countUsers.get() as { count: number }).count,
    getUserByName: (username: string) => userByName.get(username) as UserRow | undefined,
    insertUser: (row: UserRow) => {
      insertUser.run(row.id, row.username, row.password_hash, row.created_at);
    },
    setPasswordHash: (userId: string, hash: string) => {
      setHash.run(hash, userId);
    },
    listAccounts: () => accounts.all() as AccountSummary[],
    /** Notes saved before accounts existed (no owner yet). */
    countUnownedNotes: () => (countUnowned.get() as { count: number }).count,
    /**
     * Gives the user everything from before accounts: unowned notes, every stored image, and the
     * old favorites (the old rows stay). Returns how many notes it took.
     */
    claimLegacyData: (userId: string) => {
      const notes = Number(claimNotes.run(userId).changes);
      claimImages.run(userId);
      claimFavorites.run(userId);
      return notes;
    },

    insertSession: (tokenHash: string, userId: string, now: string) => {
      insertSession.run(tokenHash, userId, now, now);
    },
    getSession: (tokenHash: string) => getSession.get(tokenHash) as SessionRow | undefined,
    touchSession: (tokenHash: string, now: string) => {
      touchSession.run(now, tokenHash);
    },
    deleteSession: (tokenHash: string) => {
      deleteSession.run(tokenHash);
    },
    deleteUserSessions: (userId: string) => {
      deleteUserSessions.run(userId);
    },
    /** Deletes sessions last seen before `cutoff` (ISO time). */
    deleteExpiredSessions: (cutoff: string) => {
      deleteExpired.run(cutoff);
    },

    close: () => db.close(),
  };
}
