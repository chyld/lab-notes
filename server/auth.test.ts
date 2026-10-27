import { DatabaseSync } from "node:sqlite";
import type { InjectOptions } from "fastify";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountError, createAccount, firstAccountClaim, listAccounts, setPassword } from "./accounts.ts";
import { buildApp } from "./app.ts";
import { hashToken, SignInLimiter, verifyPassword } from "./auth.ts";

type App = ReturnType<typeof buildApp>;
const PASSWORD = "correct horse";

const doc = (first: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: first }] }],
});

// A real 1×1 PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const app = buildApp({ dbPath: ":memory:" });
after(() => app.close());

function login(target: App, username: string, password = PASSWORD, headers: Record<string, string> = {}) {
  return target.inject({ method: "POST", url: "/api/auth/login", payload: { username, password }, headers });
}

/** The Cookie header for a fresh session as `username` (creating the account if needed). */
async function session(target: App, username: string): Promise<string> {
  try {
    await createAccount(target.db, username, PASSWORD);
  } catch (err) {
    if (!(err instanceof AccountError)) throw err;
  }
  const res = await login(target, username);
  assert.equal(res.statusCode, 200, res.body);
  return String(res.headers["set-cookie"]).split(";")[0];
}

test("status, sign-in, and sign-out", async () => {
  const fresh = buildApp({ dbPath: ":memory:" });
  let res = await fresh.inject({ method: "GET", url: "/api/auth/status" });
  assert.deepEqual(res.json(), { username: null, hasAccounts: false });
  assert.equal(res.headers["cache-control"], "no-store");

  await createAccount(fresh.db, "Alice", PASSWORD); // stored lowercased
  res = await login(fresh, "  ALICE ");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { username: "alice" });
  const setCookie = String(res.headers["set-cookie"]);
  assert.match(setCookie, /^lab_notes_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/);
  const cookie = setCookie.split(";")[0];

  res = await fresh.inject({ method: "GET", url: "/api/auth/status", headers: { cookie } });
  assert.deepEqual(res.json(), { username: "alice", hasAccounts: true });

  // Sign-out is a form post: 303 to "/", the cookie cleared, the session gone.
  res = await fresh.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: "",
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, "/");
  assert.equal(String(res.headers["set-cookie"]), "lab_notes_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res = await fresh.inject({ method: "GET", url: "/api/notes", headers: { cookie } });
  assert.equal(res.statusCode, 401);
  await fresh.close();
});

test("sign-out without the cookie clears nothing (a cross-site form post)", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "x=1",
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers["set-cookie"], undefined);
});

test("form bodies are refused everywhere but sign-out", async () => {
  const cookie = await session(app, "former");
  const res = await app.inject({
    method: "POST",
    url: "/api/notes",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: "content=x",
  });
  assert.equal(res.statusCode, 415);
});

test("wrong credentials: one message whether or not the user exists", async () => {
  await createAccount(app.db, "bob", PASSWORD);
  const wrongPassword = await login(app, "bob", "not the password");
  const noSuchUser = await login(app, "nobody", PASSWORD);
  for (const res of [wrongPassword, noSuchUser]) {
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Wrong username or password" });
    assert.equal(res.headers["set-cookie"], undefined);
  }
  // Malformed bodies are 400 (validation), never a session.
  const bad = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "bob" } });
  assert.equal(bad.statusCode, 400);
});

test("every API route needs a session, checked before validation", async () => {
  const id = "0".repeat(64);
  const routes = [
    ["GET", "/api/notes"],
    ["GET", "/api/notes?q=x"],
    ["POST", "/api/notes"], // no body: still 401, not 400
    ["GET", "/api/notes/abc"],
    ["PUT", "/api/notes/abc"],
    ["GET", "/api/favorite-fonts"],
    ["PUT", "/api/favorite-fonts/Lobster"],
    ["DELETE", "/api/favorite-fonts/a-b"], // invalid param: still 401
    ["POST", "/api/images"],
    ["GET", `/api/images/${id}`],
    ["GET", "/api/nope"], // unknown /api paths too
  ] as const;
  for (const [method, url] of routes) {
    const res = await app.inject({ method, url });
    assert.equal(res.statusCode, 401, `${method} ${url}`);
    assert.deepEqual(res.json(), { error: "You're signed out. Sign in again in another tab, then try again here." });
  }
  // A garbage or unknown session is no session.
  for (const cookie of ["lab_notes_session=nope", `lab_notes_session=${"A".repeat(43)}`, "other=1"]) {
    const res = await app.inject({ method: "GET", url: "/api/notes", headers: { cookie } });
    assert.equal(res.statusCode, 401, cookie);
  }
});

test("notes, favorites, and images are private to their user", async () => {
  const alice = await session(app, "alice2");
  const eve = await session(app, "eve");
  const as = (cookie: string, options: InjectOptions) =>
    app.inject({ ...options, headers: { ...options.headers, cookie } });

  const created = await as(alice, { method: "POST", url: "/api/notes", payload: { content: doc("Alice secret plans"), tags: ["private"] } });
  assert.equal(created.statusCode, 201);
  const { id } = created.json();

  // Eve: not in her list or search, "not found" to read or write, and untouched.
  assert.deepEqual((await as(eve, { method: "GET", url: "/api/notes" })).json(), []);
  assert.deepEqual((await as(eve, { method: "GET", url: "/api/notes?q=secret" })).json(), []);
  assert.deepEqual((await as(eve, { method: "GET", url: "/api/notes?q=%23private" })).json(), []);
  const read = await as(eve, { method: "GET", url: `/api/notes/${id}` });
  assert.equal(read.statusCode, 404);
  assert.deepEqual(read.json(), { error: "Note not found" });
  const write = await as(eve, { method: "PUT", url: `/api/notes/${id}`, payload: { content: doc("hacked") } });
  assert.equal(write.statusCode, 404);
  assert.equal((await as(alice, { method: "GET", url: `/api/notes/${id}` })).json().title, "Alice secret plans");
  assert.equal((await as(alice, { method: "GET", url: "/api/notes?q=secret" })).json().length, 1);

  // Favorite fonts are per user.
  await as(alice, { method: "PUT", url: "/api/favorite-fonts/Lobster" });
  assert.deepEqual((await as(alice, { method: "GET", url: "/api/favorite-fonts" })).json(), ["Lobster"]);
  assert.deepEqual((await as(eve, { method: "GET", url: "/api/favorite-fonts" })).json(), []);
  await as(eve, { method: "DELETE", url: "/api/favorite-fonts/Lobster" });
  assert.deepEqual((await as(alice, { method: "GET", url: "/api/favorite-fonts" })).json(), ["Lobster"]);

  // Images: only the uploader can fetch one, even knowing its id, until they upload it too.
  const up = await as(alice, { method: "POST", url: "/api/images", headers: { "content-type": "image/png" }, payload: png });
  const url = up.json().url as string;
  assert.equal((await as(alice, { method: "GET", url })).statusCode, 200);
  const denied = await as(eve, { method: "GET", url });
  assert.equal(denied.statusCode, 404);
  assert.deepEqual(denied.json(), { error: "Image not found" });
  await as(eve, { method: "POST", url: "/api/images", headers: { "content-type": "image/png" }, payload: png });
  assert.equal((await as(eve, { method: "GET", url })).statusCode, 200);
});

test("images revalidate: ETag, 304, private no-cache", async () => {
  const cookie = await session(app, "imager");
  const up = await app.inject({ method: "POST", url: "/api/images", headers: { cookie, "content-type": "image/png" }, payload: png });
  const url = up.json().url as string;
  const id = url.split("/").pop();
  const got = await app.inject({ method: "GET", url, headers: { cookie } });
  assert.equal(got.headers.etag, `"${id}"`);
  assert.equal(got.headers["cache-control"], "private, no-cache");
  const again = await app.inject({ method: "GET", url, headers: { cookie, "if-none-match": `"${id}"` } });
  assert.equal(again.statusCode, 304);
  // Signed out, even a matching ETag gets nothing.
  const out = await app.inject({ method: "GET", url, headers: { "if-none-match": `"${id}"` } });
  assert.equal(out.statusCode, 401);
});

test("a tab signed in as someone else is refused (409)", async () => {
  const cookie = await session(app, "carol");
  const headers = { cookie, "x-lab-notes-user": "dave" };
  for (const [method, url] of [["GET", "/api/notes"], ["POST", "/api/notes"]] as const) {
    const res = await app.inject({ method, url, headers, payload: method === "POST" ? { content: doc("x") } : undefined });
    assert.equal(res.statusCode, 409, `${method} ${url}`);
    assert.deepEqual(res.json(), { error: "Someone else signed in on this browser. Reload this page." });
  }
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/notes", headers: { cookie } })).json(), []);
  const same = await app.inject({ method: "GET", url: "/api/notes", headers: { cookie, "x-lab-notes-user": "carol" } });
  assert.equal(same.statusCode, 200);
});

test("signing in again replaces the session the browser had", async () => {
  const first = await session(app, "erin");
  const res = await login(app, "erin", PASSWORD, { cookie: first });
  const second = String(res.headers["set-cookie"]).split(";")[0];
  assert.notEqual(second, first);
  assert.equal((await app.inject({ method: "GET", url: "/api/notes", headers: { cookie: first } })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/api/notes", headers: { cookie: second } })).statusCode, 200);
});

test("sessions slide for 30 days, then end", async () => {
  const cookie = await session(app, "frank");
  const tokenHash = hashToken(cookie.split("=")[1]);
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  // Seen in the last hour: no write, no new cookie.
  let res = await app.inject({ method: "GET", url: "/api/notes", headers: { cookie } });
  assert.equal(res.headers["set-cookie"], undefined);

  // Seen two hours ago: re-stamped, cookie re-sent.
  app.db.touchSession(tokenHash, ago(2 * 60 * 60 * 1000));
  res = await app.inject({ method: "GET", url: "/api/notes", headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["set-cookie"]), /Max-Age=2592000/);
  assert.ok(Date.parse(app.db.getSession(tokenHash)!.last_seen_at) > Date.now() - 60_000);

  // Seen 31 days ago: over, and deleted.
  app.db.touchSession(tokenHash, ago(31 * 24 * 60 * 60 * 1000));
  res = await app.inject({ method: "GET", url: "/api/notes", headers: { cookie } });
  assert.equal(res.statusCode, 401);
  assert.equal(app.db.getSession(tokenHash), undefined);
});

test("the 11th failed sign-in in 15 minutes from one IP is refused", async () => {
  const fresh = buildApp({ dbPath: ":memory:" });
  await createAccount(fresh.db, "gina", PASSWORD);
  // Parallel: counted before the password check, so they can't all slip under the limit.
  const results = await Promise.all(Array.from({ length: 12 }, () => login(fresh, "gina", "wrong password")));
  const codes = results.map((res) => res.statusCode).sort();
  assert.deepEqual(codes, [...Array(10).fill(401), 429, 429]);
  const blocked = await login(fresh, "gina"); // even the right password, for now
  assert.equal(blocked.statusCode, 429);
  assert.deepEqual(blocked.json(), { error: "Too many sign-in attempts. Try again in a few minutes." });
  await fresh.close();
});

test("the limiter: a success uncounts only itself; old attempts age out", () => {
  const limiter = new SignInLimiter(3, 1000, 100);
  const done = [limiter.begin("ip", 0), limiter.begin("ip", 1)];
  limiter.begin("ip", 2)!(); // succeeded: uncounted
  assert.ok(limiter.begin("ip", 3)); // the third slot again
  assert.equal(limiter.begin("ip", 4), null);
  assert.ok(done.every(Boolean));
  assert.ok(limiter.begin("ip", 1005)); // the first two aged out
  assert.ok(limiter.begin("other", 4)); // per IP
});

test("TRUST_PROXY: forwarded headers count only from the proxy", async () => {
  const proxied = buildApp({ dbPath: ":memory:", trustProxy: "127.0.0.1" });
  await createAccount(proxied.db, "hank", PASSWORD);
  // inject comes from 127.0.0.1: the proxy says https, so the cookie is Secure.
  const viaProxy = await login(proxied, "hank", PASSWORD, { "x-forwarded-proto": "https" });
  assert.match(String(viaProxy.headers["set-cookie"]), /; Secure$/);
  await proxied.close();

  const direct = buildApp({ dbPath: ":memory:" });
  await createAccount(direct.db, "hank", PASSWORD);
  const ignored = await login(direct, "hank", PASSWORD, { "x-forwarded-proto": "https" });
  assert.doesNotMatch(String(ignored.headers["set-cookie"]), /Secure/);
  await direct.close();
});

test("accounts: usernames, passwords, duplicates, passwd signs out everywhere", async () => {
  const fresh = buildApp({ dbPath: ":memory:" });
  for (const bad of ["", "-x", "has space", "a".repeat(41), "émile"]) {
    await assert.rejects(createAccount(fresh.db, bad, PASSWORD), AccountError, JSON.stringify(bad));
  }
  await assert.rejects(createAccount(fresh.db, "ivan", "short"), /at least 8/);
  await assert.rejects(createAccount(fresh.db, "ivan", "x".repeat(1025)), /at most 1024/);
  await createAccount(fresh.db, "Ivan.K_9-x", PASSWORD);
  await assert.rejects(createAccount(fresh.db, "ivan.k_9-x", PASSWORD), /already an account/);
  assert.deepEqual(
    listAccounts(fresh.db).map(({ username, notes }) => ({ username, notes })),
    [{ username: "ivan.k_9-x", notes: 0 }],
  );

  // NFC: the same password with a decomposed accent still matches.
  await createAccount(fresh.db, "judy", "café au lait");
  assert.equal((await login(fresh, "judy", "café au lait")).statusCode, 200);

  const cookie = await session(fresh, "ivan.k_9-x");
  await setPassword(fresh.db, "IVAN.K_9-X", "a new password");
  assert.equal((await fresh.inject({ method: "GET", url: "/api/notes", headers: { cookie } })).statusCode, 401);
  assert.equal((await login(fresh, "ivan.k_9-x")).statusCode, 401);
  assert.equal((await login(fresh, "ivan.k_9-x", "a new password")).statusCode, 200);
  await assert.rejects(setPassword(fresh.db, "nobody", PASSWORD), /no account named nobody/);
  await fresh.close();
});

test("password hashes: scrypt format; anything malformed never matches", async () => {
  const fresh = buildApp({ dbPath: ":memory:" });
  await createAccount(fresh.db, "kate", PASSWORD);
  const hash = fresh.db.getUserByName("kate")!.password_hash;
  assert.match(hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword(PASSWORD, hash), true);
  for (const stored of ["", "plain", "scrypt$1$1$1$$", "bcrypt$x", hash.replace("scrypt$32768", "scrypt$0")]) {
    assert.equal(await verifyPassword(PASSWORD, stored), false, stored);
  }
  await fresh.close();
});

test("the first account inherits everything from before accounts; later ones start empty", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lab-notes-accounts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "notes.db");

  // A database from before accounts: notes without owners, old favorites, an image.
  const old = new DatabaseSync(dbPath);
  old.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', body TEXT NOT NULL DEFAULT '');
    CREATE TABLE favorite_fonts (family TEXT PRIMARY KEY, added_at TEXT NOT NULL);
    CREATE TABLE images (id TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);`);
  const insert = old.prepare("INSERT INTO notes (id, title, content, created_at, updated_at, tags, body) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const [i, title] of ["abc", "hello"].entries()) {
    insert.run(`n${i}`, title, JSON.stringify(doc(title)), "2026-01-01T00:00:00.000Z", `2026-01-0${i + 1}T00:00:00.000Z`, "[]", title);
  }
  old.prepare("INSERT INTO favorite_fonts VALUES (?, ?)").run("Lobster", "2026-01-01T00:00:00.000Z");
  const imageId = "a".repeat(64);
  old.prepare("INSERT INTO images VALUES (?, ?, ?, ?)").run(imageId, "image/png", png, "2026-01-01T00:00:00.000Z");
  old.close();

  const upgraded = buildApp({ dbPath });
  assert.equal(firstAccountClaim(upgraded.db), 2);
  assert.equal(await createAccount(upgraded.db, "chyld", PASSWORD), 2);
  assert.equal(firstAccountClaim(upgraded.db), null);
  assert.equal(await createAccount(upgraded.db, "guest", PASSWORD), 0);

  const owner = await session(upgraded, "chyld");
  const guest = await session(upgraded, "guest");
  const get = (cookie: string, url: string) => upgraded.inject({ method: "GET", url, headers: { cookie } });
  assert.deepEqual((await get(owner, "/api/notes")).json().map((n: { title: string }) => n.title), ["hello", "abc"]);
  assert.deepEqual((await get(owner, "/api/favorite-fonts")).json(), ["Lobster"]);
  assert.equal((await get(owner, `/api/images/${imageId}`)).statusCode, 200);
  assert.deepEqual((await get(guest, "/api/notes")).json(), []);
  assert.deepEqual((await get(guest, "/api/favorite-fonts")).json(), []);
  assert.equal((await get(guest, `/api/images/${imageId}`)).statusCode, 404);
  await upgraded.close();

  // Reopening runs the migrations again harmlessly.
  const reopened = buildApp({ dbPath });
  assert.equal((await reopened.inject({ method: "GET", url: "/api/notes", headers: { cookie: owner } })).json().length, 2);
  await reopened.close();
});
