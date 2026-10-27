import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./app.ts";
import { MAX_IMAGE_BYTES } from "./images.ts";

const doc = (first: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: first }] }],
});

const app = buildApp({ dbPath: ":memory:" });
after(() => app.close());

async function create(first: string) {
  const res = await app.inject({ method: "POST", url: "/api/notes", payload: { content: doc(first) } });
  assert.equal(res.statusCode, 201);
  return res.json();
}

test("lists no notes on a fresh database", async () => {
  const fresh = buildApp({ dbPath: ":memory:" });
  const res = await fresh.inject({ method: "GET", url: "/api/notes" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), []);
  await fresh.close();
});

test("creates, reads, and updates a note", async () => {
  const created = await create("Hello");
  assert.equal(created.title, "Hello");
  assert.deepEqual(created.content, doc("Hello"));
  assert.equal(created.createdAt, created.updatedAt);

  const got = await app.inject({ method: "GET", url: `/api/notes/${created.id}` });
  assert.equal(got.statusCode, 200);
  assert.deepEqual(got.json(), created);

  const put = await app.inject({ method: "PUT", url: `/api/notes/${created.id}`, payload: { content: doc("Renamed") } });
  assert.equal(put.statusCode, 200);
  const updated = put.json();
  assert.equal(updated.id, created.id);
  assert.equal(updated.title, "Renamed");
  assert.deepEqual(updated.content, doc("Renamed"));
  assert.equal(updated.createdAt, created.createdAt);
});

test("lists id, title, tags, and updatedAt, most recently saved first", async () => {
  const a = await create("older");
  await new Promise((r) => setTimeout(r, 5));
  const b = await create("newer");
  let list = (await app.inject({ method: "GET", url: "/api/notes" })).json();
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "tags", "title", "updatedAt"]);
  assert.equal(list[0].updatedAt, b.updatedAt);
  assert.equal(list[0].id, b.id);

  await new Promise((r) => setTimeout(r, 5));
  await app.inject({ method: "PUT", url: `/api/notes/${a.id}`, payload: { content: doc("older, edited") } });
  list = (await app.inject({ method: "GET", url: "/api/notes" })).json();
  assert.equal(list[0].id, a.id);
  assert.equal(list[0].title, "older, edited");
});

test("saves in the same millisecond still list latest first", async () => {
  const fresh = buildApp({ dbPath: ":memory:" });
  const ids: string[] = [];
  for (let i = 0; i < 30; i++) {
    const res = await fresh.inject({ method: "POST", url: "/api/notes", payload: { content: doc(`n${i}`) } });
    ids.push(res.json().id);
  }
  const list = (await fresh.inject({ method: "GET", url: "/api/notes" })).json();
  assert.deepEqual(
    list.map((n: { id: string }) => n.id),
    ids.toReversed(),
  );
  await fresh.close();
});

test("unknown note ids are 404 { error }", async () => {
  const get = await app.inject({ method: "GET", url: "/api/notes/nope" });
  assert.equal(get.statusCode, 404);
  assert.deepEqual(get.json(), { error: "Note not found" });

  const put = await app.inject({ method: "PUT", url: "/api/notes/nope", payload: { content: doc("x") } });
  assert.equal(put.statusCode, 404);
  assert.deepEqual(put.json(), { error: "Note not found" });
});

test("invalid bodies are 400 { error } and are not coerced", async () => {
  const bad = [
    {},
    { content: null },
    { content: { type: "paragraph" } },
    { content: { type: "doc", content: "x" } },
    { content: { type: "doc", content: [null] } },
    { content: { type: "doc" } },
    { content: { type: "doc", content: [] } },
  ];
  for (const payload of bad) {
    const res = await app.inject({ method: "POST", url: "/api/notes", payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.equal(typeof res.json().error, "string");
    assert.deepEqual(Object.keys(res.json()), ["error"]);
  }
});

test("over-deep documents are 400 { error } and nothing is stored", async () => {
  let node: object = { type: "paragraph", content: [{ type: "text", text: "deep" }] };
  for (let i = 0; i < 5000; i++) node = { type: "blockquote", content: [node] };
  const deep = { type: "doc", content: [node] };
  const before = (await app.inject({ method: "GET", url: "/api/notes" })).json().length;

  const post = await app.inject({ method: "POST", url: "/api/notes", payload: { content: deep } });
  assert.equal(post.statusCode, 400);
  assert.deepEqual(post.json(), { error: "Document is nested too deeply" });
  assert.equal((await app.inject({ method: "GET", url: "/api/notes" })).json().length, before);

  const note = await create("shallow");
  const put = await app.inject({ method: "PUT", url: `/api/notes/${note.id}`, payload: { content: deep } });
  assert.equal(put.statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: `/api/notes/${note.id}` })).json().title, "shallow");
});

test("realistically nested documents are accepted", async () => {
  let node: object = { type: "paragraph", content: [{ type: "text", text: "nested list" }] };
  for (let i = 0; i < 40; i++) node = { type: "bulletList", content: [{ type: "listItem", content: [node] }] };
  const res = await app.inject({ method: "POST", url: "/api/notes", payload: { content: { type: "doc", content: [node] } } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().title, "nested list");
});

test("malformed URLs are 400 { error }", async () => {
  for (const url of ["/api/notes/%ZZ", "/api/notes/%E0%A4%A"]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 400, url);
    assert.deepEqual(Object.keys(res.json()), ["error"]);
  }
});

test("an unsupported content type is 415 { error }", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/notes",
    headers: { "content-type": "application/xml" },
    payload: "<doc/>",
  });
  assert.equal(res.statusCode, 415);
  assert.deepEqual(Object.keys(res.json()), ["error"]);
});

test("an oversized body is 413 { error }", async () => {
  const res = await app.inject({ method: "POST", url: "/api/notes", payload: { content: doc("x".repeat(1_100_000)) } });
  assert.equal(res.statusCode, 413);
  assert.deepEqual(Object.keys(res.json()), ["error"]);
});

test("unknown routes are JSON 404s without a static dir", async () => {
  for (const [method, url] of [["GET", "/api/nope"], ["GET", "/notes/abc"], ["POST", "/anything"]] as const) {
    const res = await app.inject({ method, url });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: "Not found" });
  }
});

test("with a static dir: SPA fallback for GET pages only", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "notes-static-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>app</title>");
  const web = buildApp({ dbPath: ":memory:", staticDir: dir });
  t.after(async () => {
    await web.close();
    rmSync(dir, { recursive: true, force: true });
  });

  for (const url of ["/", "/notes/abc", "/notes/new?x=1"]) {
    const res = await web.inject({ method: "GET", url });
    assert.equal(res.statusCode, 200, url);
    assert.match(res.headers["content-type"] as string, /text\/html/);
  }

  const misses = [
    ["GET", "/api/nope"],
    ["GET", "/api?x=1"],
    ["GET", "/assets/missing.js"],
    ["GET", "/favicon.ico"],
    ["POST", "/anything"],
    ["DELETE", "/notes/abc"],
  ] as const;
  for (const [method, url] of misses) {
    const res = await web.inject({ method, url });
    assert.equal(res.statusCode, 404, `${method} ${url}`);
    assert.deepEqual(res.json(), { error: "Not found" });
  }
});

test("a static dir without index.html serves no SPA fallback", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "notes-static-"));
  const web = buildApp({ dbPath: ":memory:", staticDir: dir });
  t.after(async () => {
    await web.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const url of ["/", "/notes/abc"]) {
    const res = await web.inject({ method: "GET", url });
    assert.equal(res.statusCode, 404, url);
    assert.deepEqual(res.json(), { error: "Not found" });
  }
});

// A real 1×1 PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function upload(payload: Buffer, type = "image/png") {
  return app.inject({ method: "POST", url: "/api/images", headers: { "content-type": type }, payload });
}

test("uploads an image and serves it back", async () => {
  const res = await upload(png);
  assert.equal(res.statusCode, 201);
  const hash = createHash("sha256").update(png).digest("hex");
  assert.deepEqual(res.json(), { url: `/api/images/${hash}` });

  const got = await app.inject({ method: "GET", url: res.json().url });
  assert.equal(got.statusCode, 200);
  assert.deepEqual(got.rawPayload, png);
  assert.equal(got.headers["content-type"], "image/png");
  assert.equal(got.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(got.headers["x-content-type-options"], "nosniff");
  assert.equal(got.headers["content-security-policy"], "default-src 'none'; style-src 'unsafe-inline'; sandbox");

  const head = await app.inject({ method: "HEAD", url: res.json().url });
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers["content-type"], "image/png");
});

test("stores the same image once", async () => {
  const first = (await upload(png)).json();
  const second = await upload(png);
  assert.equal(second.statusCode, 201);
  assert.deepEqual(second.json(), first);
});

test("detects the image type from its bytes, not the header", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const gif = Buffer.from("GIF89a-rest");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
  for (const [bytes, type] of [[jpeg, "image/jpeg"], [gif, "image/gif"], [webp, "image/webp"], [png, "image/png"]] as const) {
    const res = await upload(bytes, "image/webp"); // deliberately the wrong header for most
    assert.equal(res.statusCode, 201);
    const got = await app.inject({ method: "GET", url: res.json().url });
    assert.equal(got.headers["content-type"], type);
  }
});

test("rejects bytes that aren't a supported image", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  for (const payload of [svg, Buffer.from("not an image"), Buffer.from("RIFF0000WAVE")]) {
    const res = await upload(payload);
    assert.equal(res.statusCode, 415);
    assert.deepEqual(res.json(), { error: "Unsupported image type" });
  }
});

test("rejects an empty image", async () => {
  const res = await upload(Buffer.alloc(0));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "Image is empty" });
});

test("rejects images over 25 MiB with 413", async () => {
  const big = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES + 1 - png.length)]);
  const res = await upload(big);
  assert.equal(res.statusCode, 413);
  assert.equal(typeof res.json().error, "string");
  const ok = await upload(Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES - png.length)]));
  assert.equal(ok.statusCode, 201);
});

test("image content types are only parsed by the upload route", async () => {
  const note = await app.inject({ method: "POST", url: "/api/notes", headers: { "content-type": "image/png" }, payload: png });
  assert.equal(note.statusCode, 415);
  // Any image/* (or untyped bytes) reaches detection, which decides.
  const svg = await upload(Buffer.from("<svg/>"), "image/svg+xml");
  assert.equal(svg.statusCode, 415);
  assert.deepEqual(svg.json(), { error: "Unsupported image type" });
  const avif = await upload(Buffer.from("....ftypavif"), "image/avif");
  assert.deepEqual(avif.json(), { error: "Unsupported image type" });
  const untyped = await upload(png, "application/octet-stream");
  assert.equal(untyped.statusCode, 201);
  const json = await app.inject({ method: "POST", url: "/api/images", payload: { a: 1 } });
  assert.equal(json.statusCode, 415);
  assert.equal(typeof json.json().error, "string");
});

test("unknown or malformed image ids are JSON 404s", async () => {
  for (const id of ["0".repeat(64), "abc", "A".repeat(64), "..%2Fnotes.db"]) {
    const res = await app.inject({ method: "GET", url: `/api/images/${id}` });
    assert.equal(res.statusCode, 404, id);
    assert.deepEqual(res.json(), { error: "Image not found" });
  }
});

async function createTagged(first: string, tags: unknown) {
  return app.inject({ method: "POST", url: "/api/notes", payload: { content: doc(first), tags } });
}

test("saves tags on create and update; absent tags on PUT keep them", async () => {
  const created = (await createTagged("Tagged", ["homelab", "net2"])).json();
  assert.deepEqual(created.tags, ["homelab", "net2"]);
  const untagged = await create("No tags");
  assert.deepEqual(untagged.tags, []);

  const put = await app.inject({ method: "PUT", url: `/api/notes/${created.id}`, payload: { content: doc("Tagged"), tags: ["zfs"] } });
  assert.deepEqual(put.json().tags, ["zfs"]);
  const keep = await app.inject({ method: "PUT", url: `/api/notes/${created.id}`, payload: { content: doc("Tagged v2") } });
  assert.deepEqual(keep.json().tags, ["zfs"]);
  const cleared = await app.inject({ method: "PUT", url: `/api/notes/${created.id}`, payload: { content: doc("Tagged v3"), tags: [] } });
  assert.deepEqual(cleared.json().tags, []);

  const got = (await app.inject({ method: "GET", url: `/api/notes/${untagged.id}` })).json();
  assert.deepEqual(got.tags, []);
  const list = (await app.inject({ method: "GET", url: "/api/notes" })).json();
  assert.deepEqual(list.find((n: { id: string }) => n.id === created.id).tags, []);
});

test("rejects invalid tags with 400 and writes nothing", async () => {
  const before = (await app.inject({ method: "GET", url: "/api/notes" })).json().length;
  const bad = [
    ["Upper"], ["has space"], ["dash-ed"], [""], ["a".repeat(41)], ["dup", "dup"], "notarray", [1],
    Array.from({ length: 51 }, (_, i) => `t${i}`),
  ];
  for (const tags of bad) {
    const res = await createTagged("Bad", tags);
    assert.equal(res.statusCode, 400, JSON.stringify(tags));
    assert.equal(typeof res.json().error, "string");
  }
  assert.equal((await app.inject({ method: "GET", url: "/api/notes" })).json().length, before);
  const ok = await createTagged("Edge", ["a".repeat(40), "0", ...Array.from({ length: 48 }, (_, i) => `x${i}`)]);
  assert.equal(ok.statusCode, 201);
});

test("migrates a database created before tags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "labnotes-migrate-"));
  const path = join(dir, "notes.db");
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  old.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, ?)").run(
    "old-1", "Old note", JSON.stringify(doc("Old note")), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
  );
  old.close();
  const migrated = buildApp({ dbPath: path });
  try {
    const list = (await migrated.inject({ method: "GET", url: "/api/notes" })).json();
    assert.deepEqual(list, [{ id: "old-1", title: "Old note", tags: [], updatedAt: "2026-01-01T00:00:00.000Z" }]);
    const put = await migrated.inject({ method: "PUT", url: "/api/notes/old-1", payload: { content: doc("Old note"), tags: ["kept"] } });
    assert.deepEqual(put.json().tags, ["kept"]);
    await migrated.close();
    // Opening the migrated file again (column already there) is a no-op, not a failed ALTER.
    const reopened = buildApp({ dbPath: path });
    const again = (await reopened.inject({ method: "GET", url: "/api/notes" })).json();
    assert.equal(again.length, 1);
    assert.deepEqual(again[0].tags, ["kept"]);
    await reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const richDoc = (...lines: string[]) => ({
  type: "doc",
  content: lines.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
});

test("searches the full text and tags", async () => {
  const fresh = buildApp({ dbPath: ":memory:" });
  try {
    const make = async (lines: string[], tags: string[]) =>
      (await fresh.inject({ method: "POST", url: "/api/notes", payload: { content: richDoc(...lines), tags } })).json();
    const proxmox = await make(["Proxmox setup", "Install the ZFS pool on Été disks"], ["homelab", "storage"]);
    const network = await make(["Network plan", "VLANs for the homelab"], ["homelab", "network"]);
    const groceries = await make(["Groceries", "100% juice_box"], []);
    const untitled = await make(["", "only a body line"], []);
    const ids = async (q: string) =>
      (await fresh.inject({ method: "GET", url: `/api/notes?q=${encodeURIComponent(q)}` })).json().map((n: { id: string }) => n.id);

    assert.deepEqual(await ids("zfs"), [proxmox.id]); // body, case-insensitive
    assert.deepEqual(await ids("prox"), [proxmox.id]); // substring of the title
    assert.deepEqual(await ids("été"), [proxmox.id]); // non-ASCII case folding
    assert.deepEqual(await ids("homelab"), [network.id]); // words search text, not tags
    assert.deepEqual(await ids("#home"), [network.id, proxmox.id]); // tag prefix, list order
    assert.deepEqual(await ids("#homelab #net"), [network.id]); // every token must match
    assert.deepEqual(await ids("#home vlans"), [network.id]);
    assert.deepEqual(await ids("pool missing"), []);
    assert.deepEqual(await ids("100%"), [groceries.id]); // no LIKE wildcards
    assert.deepEqual(await ids("juice_box"), [groceries.id]);
    assert.deepEqual(await ids("#HomeLab"), [network.id, proxmox.id]); // tag prefix normalized
    assert.equal((await ids("   ")).length, 4); // blank lists everything
    assert.equal((await ids("#")).length, 4); // bare # is ignored
    assert.equal((await ids("#!!")).length, 4); // empty after cleaning: ignored
    assert.deepEqual(await ids("untitled"), []); // the placeholder title isn't searchable text
    assert.deepEqual(await ids("body line"), [untitled.id]);
    assert.deepEqual(await ids("e\u0301te\u0301"), [proxmox.id]); // NFD query, NFC text

    // Saving updates what's searchable.
    await fresh.inject({ method: "PUT", url: `/api/notes/${groceries.id}`, payload: { content: richDoc("Groceries", "zfs cables") } });
    assert.deepEqual((await ids("zfs")).sort(), [groceries.id, proxmox.id].sort());

    const tooLong = await fresh.inject({ method: "GET", url: `/api/notes?q=${"a".repeat(501)}` });
    assert.equal(tooLong.statusCode, 400);
    // The list never includes the body.
    const list = (await fresh.inject({ method: "GET", url: "/api/notes?q=zfs" })).json();
    assert.equal("body" in list[0], false);
  } finally {
    await fresh.close();
  }
});

test("backfills the search text of notes saved before search existed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "labnotes-body-"));
  const path = join(dir, "notes.db");
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]')`);
  const insert = old.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("n1", "Old", JSON.stringify(richDoc("Old", "kubernetes cluster")), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "[]");
  insert.run("n2", "Broken", "{not json", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "[]");
  old.close();
  try {
    const app1 = buildApp({ dbPath: path });
    const found = (await app1.inject({ method: "GET", url: "/api/notes?q=kubernetes" })).json();
    assert.deepEqual(found.map((n: { id: string }) => n.id), ["n1"]);
    await app1.close();
    // Reopening doesn't redo or break anything.
    const app2 = buildApp({ dbPath: path });
    assert.equal((await app2.inject({ method: "GET", url: "/api/notes?q=cluster" })).json().length, 1);
    await app2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("favorite fonts: add, list in the order added, remove; both idempotent", async () => {
  const fresh = buildApp({ dbPath: ":memory:" });
  const list = async () => (await fresh.inject({ method: "GET", url: "/api/favorite-fonts" })).json();
  assert.deepEqual(await list(), []);

  for (const family of ["Lobster", "Open Sans", "Roboto Mono"]) {
    const res = await fresh.inject({ method: "PUT", url: `/api/favorite-fonts/${encodeURIComponent(family)}` });
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, "");
  }
  assert.deepEqual(await list(), ["Lobster", "Open Sans", "Roboto Mono"]);

  // Adding again keeps its place.
  assert.equal((await fresh.inject({ method: "PUT", url: "/api/favorite-fonts/Lobster" })).statusCode, 204);
  assert.deepEqual(await list(), ["Lobster", "Open Sans", "Roboto Mono"]);

  assert.equal((await fresh.inject({ method: "DELETE", url: "/api/favorite-fonts/Open%20Sans" })).statusCode, 204);
  assert.deepEqual(await list(), ["Lobster", "Roboto Mono"]);
  assert.equal((await fresh.inject({ method: "DELETE", url: "/api/favorite-fonts/Open%20Sans" })).statusCode, 204);

  // Re-adding puts it last.
  await fresh.inject({ method: "PUT", url: "/api/favorite-fonts/Open%20Sans" });
  assert.deepEqual(await list(), ["Lobster", "Roboto Mono", "Open Sans"]);
  await fresh.close();
});

test("favorite fonts: rejects family names that aren't Google Fonts-shaped", async () => {
  const fresh = buildApp({ dbPath: ":memory:" });
  const long = Array.from({ length: 20 }, () => "Abcde").join(" "); // 119 characters
  for (const family of ["Comic%2BSans", "%22x%22", "a-b", "%20Lobster", "Lobster%20", "Open%20%20Sans", "%C3%A9", encodeURIComponent(long)]) {
    for (const method of ["PUT", "DELETE"] as const) {
      const res = await fresh.inject({ method, url: `/api/favorite-fonts/${family}` });
      assert.equal(res.statusCode, 400, `${method} ${family}`);
      assert.equal(typeof res.json().error, "string");
    }
  }
  assert.equal((await fresh.inject({ method: "PUT", url: "/api/favorite-fonts/" })).statusCode, 400);
  // 100 characters, 198 once its spaces are encoded: still within the router's limit.
  const longest = Array.from({ length: 50 }, () => "A").join(" ") + "B";
  assert.equal(longest.length, 100);
  const ok = await fresh.inject({ method: "PUT", url: `/api/favorite-fonts/${encodeURIComponent(longest)}` });
  assert.equal(ok.statusCode, 204);
  assert.deepEqual((await fresh.inject({ method: "GET", url: "/api/favorite-fonts" })).json(), [longest]);
  // Over the router's still-encoded limit (300): refused before validation, as URI Too Long.
  const huge = await fresh.inject({ method: "PUT", url: `/api/favorite-fonts/${"A".repeat(301)}` });
  assert.equal(huge.statusCode, 414);
  assert.equal(typeof huge.json().error, "string");
  await fresh.close();
});

test("favorite fonts: at most 200; existing ones can still be re-added and removed", async () => {
  const fresh = buildApp({ dbPath: ":memory:" });
  for (let i = 0; i < 200; i++) {
    const res = await fresh.inject({ method: "PUT", url: `/api/favorite-fonts/Font${i}` });
    assert.equal(res.statusCode, 204);
  }
  const over = await fresh.inject({ method: "PUT", url: "/api/favorite-fonts/Lobster" });
  assert.equal(over.statusCode, 400);
  assert.deepEqual(over.json(), { error: "Too many favorite fonts" });
  assert.equal((await fresh.inject({ method: "PUT", url: "/api/favorite-fonts/Font7" })).statusCode, 204);
  assert.equal((await fresh.inject({ method: "DELETE", url: "/api/favorite-fonts/Font7" })).statusCode, 204);
  assert.equal((await fresh.inject({ method: "PUT", url: "/api/favorite-fonts/Lobster" })).statusCode, 204);
  const list = (await fresh.inject({ method: "GET", url: "/api/favorite-fonts" })).json();
  assert.equal(list.length, 200);
  assert.equal(list.at(-1), "Lobster");
  await fresh.close();
});

test("favorite fonts persist and an older database gets the table", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lab-notes-fav-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "notes.db");
  // A database from before favorites: notes and images only.
  const old = new DatabaseSync(dbPath);
  old.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', body TEXT NOT NULL DEFAULT '')`);
  old.close();

  const first = buildApp({ dbPath });
  assert.equal((await first.inject({ method: "PUT", url: "/api/favorite-fonts/Lobster" })).statusCode, 204);
  await first.close();
  const second = buildApp({ dbPath });
  assert.deepEqual((await second.inject({ method: "GET", url: "/api/favorite-fonts" })).json(), ["Lobster"]);
  await second.close();
});
