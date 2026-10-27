import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./app.ts";

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

test("lists id and title, most recently saved first", async () => {
  const a = await create("older");
  await new Promise((r) => setTimeout(r, 5));
  const b = await create("newer");
  let list = (await app.inject({ method: "GET", url: "/api/notes" })).json();
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "title"]);
  assert.equal(list[0].id, b.id);

  await new Promise((r) => setTimeout(r, 5));
  await app.inject({ method: "PUT", url: `/api/notes/${a.id}`, payload: { content: doc("older, edited") } });
  list = (await app.inject({ method: "GET", url: "/api/notes" })).json();
  assert.equal(list[0].id, a.id);
  assert.equal(list[0].title, "older, edited");
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
  ];
  for (const payload of bad) {
    const res = await app.inject({ method: "POST", url: "/api/notes", payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.equal(typeof res.json().error, "string");
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
