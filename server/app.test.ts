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

test("lists id, title, and tags, most recently saved first", async () => {
  const a = await create("older");
  await new Promise((r) => setTimeout(r, 5));
  const b = await create("newer");
  let list = (await app.inject({ method: "GET", url: "/api/notes" })).json();
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "tags", "title"]);
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
    assert.deepEqual(list, [{ id: "old-1", title: "Old note", tags: [] }]);
    const put = await migrated.inject({ method: "PUT", url: "/api/notes/old-1", payload: { content: doc("Old note"), tags: ["kept"] } });
    assert.deepEqual(put.json().tags, ["kept"]);
    await migrated.close();
    // Opening the migrated file again (column already there) is a no-op, not a failed ALTER.
    const reopened = buildApp({ dbPath: path });
    const again = (await reopened.inject({ method: "GET", url: "/api/notes" })).json();
    assert.deepEqual(again, [{ id: "old-1", title: "Old note", tags: ["kept"] }]);
    await reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
