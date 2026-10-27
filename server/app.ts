import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify, { LogController, type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import {
  dummyPasswordHash,
  expiryCutoff,
  hashToken,
  newSessionToken,
  normalizeUsername,
  readSessionCookie,
  sessionAlive,
  sessionCookie,
  sessionStale,
  SignInLimiter,
  verifyPassword,
} from "./auth.ts";
import { openDb, type Db, type NoteListRow, type NoteRow } from "./db.ts";
import { detectImageType, IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "./images.ts";
import { isEmptyQuery, matchesQuery, parseQuery } from "./search.ts";
import { extractText, extractTitle } from "./title.ts";

export type AppOptions = {
  dbPath: string;
  staticDir?: string;
  logger?: boolean;
  /** The reverse proxy's addresses (TRUST_PROXY): only they're believed about X-Forwarded-*. */
  trustProxy?: string;
};

declare module "fastify" {
  interface FastifyInstance {
    /** The app's database (tests create accounts through it). */
    db: Db;
  }
}

/** Who a request is signed in as. */
type SessionUser = { id: string; username: string };

const SIGNED_OUT = "You're signed out. Sign in again in another tab, then try again here.";
const OTHER_USER = "Someone else signed in on this browser. Reload this page.";
const WRONG_CREDENTIALS = "Wrong username or password";
const TOO_MANY = "Too many sign-in attempts. Try again in a few minutes.";

// The only /api paths that don't need a session.
const PUBLIC_API = new Set(["/api/auth/status", "/api/auth/login", "/api/auth/logout"]);

/**
 * The /api path a request is for, or null if it's a page or a file. Judged by the route the router
 * matched (it decodes the path first, so `/%61pi/notes` is the notes route); for an unmatched
 * path, by the path decoded and lowercased too, so `/api%2Fnotes` or `/API/notes` count as API.
 */
function apiPath(request: FastifyRequest): string | null {
  const route = request.routeOptions.url;
  if (route !== undefined) return route.startsWith("/api/") ? route : null;
  const raw = request.url.split("?", 1)[0];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw).toLowerCase();
  } catch {
    // a malformed escape: judge it as written
  }
  return [raw, decoded].find((p) => p === "/api" || p.startsWith("/api/")) ?? null;
}

const loginBody = {
  type: "object",
  required: ["username", "password"],
  properties: {
    username: { type: "string", minLength: 1, maxLength: 100 },
    // Room for 1024 characters even typed decomposed (an accent as two code points): the real
    // limit is checked on the normalized password when it's set.
    password: { type: "string", minLength: 1, maxLength: 4096 },
  },
} as const;

// Lowercase letters and digits only, unique within the note (see SPEC "Tags").
const tagsSchema = {
  type: "array",
  maxItems: 50,
  uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 40, pattern: "^[a-z0-9]+$" },
} as const;

const docBody = {
  type: "object",
  required: ["content"],
  properties: {
    tags: tagsSchema,
    content: {
      type: "object",
      required: ["type", "content"],
      properties: {
        type: { const: "doc" },
        // ProseMirror's doc needs at least one block, or the editor can't open it.
        content: { type: "array", minItems: 1, items: { type: "object" } },
      },
    },
  },
} as const;

const listQuery = {
  type: "object",
  properties: { q: { type: "string", maxLength: 500 } },
} as const;

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

// Every Google Fonts family is letters, digits, and single spaces (see SPEC "Favorite fonts").
const familyParams = {
  type: "object",
  required: ["family"],
  properties: { family: { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9]+( [A-Za-z0-9]+)*$" } },
} as const;

export const MAX_FAVORITE_FONTS = 200;

type DocBody = { content: { type: "doc"; content: object[] }; tags?: string[] };
type IdParams = { id: string };
type FamilyParams = { family: string };

// JSON nesting levels (each Tiptap node level is two: the node and its content array).
// Real documents stay far below this; the cap keeps recursive JSON handling off the stack limit.
const MAX_DOC_DEPTH = 200;

function exceedsMaxDepth(value: unknown): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop()!;
    if (depth > MAX_DOC_DEPTH) return true;
    if (typeof current === "object" && current !== null) {
      for (const child of Object.values(current)) stack.push([child, depth + 1]);
    }
  }
  return false;
}

const tooDeep = { error: "Document is nested too deeply" };

const IMAGE_ID = /^[0-9a-f]{64}$/;

function toNote(row: NoteRow) {
  return {
    id: row.id,
    title: row.title,
    content: JSON.parse(row.content) as unknown,
    tags: JSON.parse(row.tags) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildApp({ dbPath, staticDir, logger = false, trustProxy }: AppOptions) {
  const app = Fastify({
    logger,
    trustProxy: trustProxy || false,
    logController: new LogController({ disableRequestLogging: true }),
    // Raw (still %-encoded) length: a 100-character family name with spaces is longer encoded.
    routerOptions: { maxParamLength: 300 },
    ajv: { customOptions: { coerceTypes: false } },
    // Errors raised before routing (e.g. a malformed %-escape) also use the { error } shape.
    frameworkErrors: (err, _request, reply) => {
      (reply as FastifyReply).code(err.statusCode ?? 400).header("Cache-Control", "no-store").send({ error: err.message });
    },
  });
  const db = openDb(dbPath);
  app.decorate("db", db);
  app.addHook("onClose", async () => db.close());
  db.deleteExpiredSessions(expiryCutoff(Date.now()));
  void dummyPasswordHash(); // made now, so the first unknown-user sign-in isn't slower than the rest

  // Sessions (see SPEC "Accounts and sign-in"). Over plain http on the LAN a Secure cookie would be
  // dropped, so it's only Secure over https (as reported by a trusted proxy, if any).
  const secure = (request: FastifyRequest) => request.protocol === "https";

  /**
   * The request's session, if it has a live one. `touch()` re-stamps (and re-sends) one last seen
   * over an hour ago: called only once the request is accepted, so a refused one writes nothing.
   */
  function sessionFor(request: FastifyRequest, reply: FastifyReply): (SessionUser & { touch: () => void }) | null {
    const token = readSessionCookie(request.headers.cookie);
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = db.getSession(tokenHash);
    if (!row) return null;
    const now = Date.now();
    if (!sessionAlive(row.last_seen_at, now)) {
      db.deleteSession(tokenHash);
      return null;
    }
    const touch = () => {
      if (!sessionStale(row.last_seen_at, now)) return;
      db.touchSession(tokenHash, new Date(now).toISOString());
      reply.header("Set-Cookie", sessionCookie(token, secure(request)));
    };
    return { id: row.user_id, username: row.username, touch };
  }

  const users = new WeakMap<FastifyRequest, SessionUser>();
  /**
   * The signed-in user, set by the hook below. Fails closed: a request that somehow got past it
   * without one is a 401, never a handler running for nobody.
   */
  function userOf(request: FastifyRequest): SessionUser {
    const user = users.get(request);
    if (!user) throw Object.assign(new Error(SIGNED_OUT), { statusCode: 401 });
    return user;
  }

  // Every /api request but the three auth ones needs a session: checked first thing (before body
  // parsing and validation), and for unknown /api paths too. Pages and files never do.
  app.addHook("onRequest", async (request, reply) => {
    const path = apiPath(request);
    if (path === null) return;
    reply.header("Cache-Control", "no-store"); // Back after signing out can't show cached notes
    if (PUBLIC_API.has(path)) return;
    const session = sessionFor(request, reply);
    if (!session) return reply.code(401).send({ error: SIGNED_OUT });
    // A tab signed in as someone else (the cookie changed under it): refuse before anything is
    // read or written (not even the other user's session is re-stamped).
    const expected = request.headers["x-lab-notes-user"];
    if (typeof expected === "string" && expected !== session.username) {
      return reply.code(409).send({ error: OTHER_USER });
    }
    session.touch();
    users.set(request, { id: session.id, username: session.username });
  });

  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: err.message });
    }
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  });

  const serveStatic = staticDir !== undefined && existsSync(join(staticDir, "index.html"));
  if (serveStatic) {
    app.register(fastifyStatic, { root: staticDir });
  }

  // SPA fallback: app pages (GET/HEAD, outside /api, no file extension) get index.html.
  // A missing file such as a stale /assets/*.js stays a 404 instead of becoming HTML.
  app.setNotFoundHandler((request, reply) => {
    const isRead = request.method === "GET" || request.method === "HEAD";
    const path = request.url.split("?", 1)[0];
    const isApi = apiPath(request) !== null; // an API miss is JSON, never the app's page
    const isFile = /\.[^/]*$/.test(path);
    if (serveStatic && isRead && !isApi && !isFile) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });

  app.get("/api/auth/status", async (request, reply) => {
    const session = sessionFor(request, reply);
    session?.touch();
    return { username: session?.username ?? null, hasAccounts: db.countUsers() > 0 };
  });

  const limiter = new SignInLimiter();

  app.post<{ Body: { username: string; password: string } }>(
    "/api/auth/login",
    { schema: { body: loginBody } },
    async (request, reply) => {
      const uncount = limiter.begin(request.ip);
      if (!uncount) return reply.code(429).send({ error: TOO_MANY });
      const user = db.getUserByName(normalizeUsername(request.body.username));
      // An unknown username still costs one scrypt, so timing doesn't reveal which ones exist.
      const ok = await verifyPassword(request.body.password, user?.password_hash ?? (await dummyPasswordHash()));
      if (!user || !ok) return reply.code(401).send({ error: WRONG_CREDENTIALS });
      const { token, hash } = newSessionToken();
      // In one transaction with the session's creation: if `passwd` (another process, maybe) changed
      // the password while it was being checked, the old one doesn't get a session.
      const created = db.immediate(() => {
        if (db.getUserByName(user.username)?.password_hash !== user.password_hash) return false;
        db.deleteExpiredSessions(expiryCutoff(Date.now()));
        // A session this browser already had is replaced, not kept alongside.
        const previous = readSessionCookie(request.headers.cookie);
        if (previous) db.deleteSession(hashToken(previous));
        db.insertSession(hash, user.id, new Date().toISOString());
        return true;
      });
      if (!created) return reply.code(401).send({ error: WRONG_CREDENTIALS });
      uncount();
      reply.header("Set-Cookie", sessionCookie(token, secure(request)));
      return { username: user.username };
    },
  );

  // Signing out is a real form post (the page reloads), so form bodies are accepted here only.
  app.register(async (auth) => {
    auth.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 1024 },
      (_request, _body, done) => done(null, {}),
    );
    auth.post("/api/auth/logout", async (request, reply) => {
      // Only a request that brought the cookie clears it: a cross-site form post arrives without
      // the (SameSite=Lax) cookie, and mustn't be able to sign anyone out.
      const token = readSessionCookie(request.headers.cookie);
      if (token) {
        db.deleteSession(hashToken(token));
        reply.header("Set-Cookie", sessionCookie(null, secure(request)));
      }
      return reply.code(303).header("Location", "/").send();
    });
  });

  const toSummary = (row: NoteListRow) => ({
    id: row.id,
    title: row.title,
    tags: JSON.parse(row.tags) as string[],
    updatedAt: row.updated_at,
  });

  // ?q= searches (see SPEC "Search"); blank or absent lists every note.
  app.get<{ Querystring: { q?: string } }>("/api/notes", { schema: { querystring: listQuery } }, async (request) => {
    const owner = userOf(request).id;
    const query = parseQuery(request.query.q ?? "");
    if (isEmptyQuery(query)) return db.listNotes(owner).map(toSummary);
    // Only word searches need every note's text; tag-only searches use the plain list.
    const rows =
      query.words.length > 0 ? db.searchableNotes(owner) : db.listNotes(owner).map((row) => ({ ...row, body: "" }));
    return rows
      .map((row) => ({ row, tags: JSON.parse(row.tags) as string[] }))
      .filter(({ row, tags }) => matchesQuery({ body: row.body, tags }, query))
      .map(({ row }) => toSummary(row));
  });

  app.get<{ Params: IdParams }>("/api/notes/:id", { schema: { params: idParams } }, async (request, reply) => {
    // Another user's note is "not found", exactly like a missing one.
    const row = db.getNote(request.params.id, userOf(request).id);
    if (!row) return reply.code(404).send({ error: "Note not found" });
    return toNote(row);
  });

  app.post<{ Body: DocBody }>("/api/notes", { schema: { body: docBody } }, async (request, reply) => {
    if (exceedsMaxDepth(request.body.content)) return reply.code(400).send(tooDeep);
    const now = new Date().toISOString();
    const row: NoteRow & { owner_id: string } = {
      id: randomUUID(),
      owner_id: userOf(request).id,
      title: extractTitle(request.body.content),
      content: JSON.stringify(request.body.content),
      created_at: now,
      updated_at: now,
      tags: JSON.stringify(request.body.tags ?? []),
      body: extractText(request.body.content),
    };
    db.insertNote(row);
    return reply.code(201).send(toNote(row));
  });

  app.put<{ Params: IdParams; Body: DocBody }>(
    "/api/notes/:id",
    { schema: { params: idParams, body: docBody } },
    async (request, reply) => {
      const { id } = request.params;
      const owner = userOf(request).id;
      const content = request.body.content;
      if (exceedsMaxDepth(content)) return reply.code(400).send(tooDeep);
      const tags = request.body.tags === undefined ? null : JSON.stringify(request.body.tags);
      // One statement scoped to the owner: another user's note can't be touched, only "not found".
      const updated = db.updateNote(
        id,
        owner,
        extractTitle(content),
        JSON.stringify(content),
        extractText(content),
        tags,
        new Date().toISOString(),
      );
      if (!updated) return reply.code(404).send({ error: "Note not found" });
      return toNote(db.getNote(id, owner)!);
    },
  );

  app.get("/api/favorite-fonts", async (request) => db.listFavoriteFonts(userOf(request).id));

  app.put<{ Params: FamilyParams }>(
    "/api/favorite-fonts/:family",
    { schema: { params: familyParams } },
    async (request, reply) => {
      const { family } = request.params;
      const user = userOf(request).id;
      // Synchronous check and insert, so no other request can slip in between.
      if (!db.isFavoriteFont(user, family)) {
        if (db.countFavoriteFonts(user) >= MAX_FAVORITE_FONTS) {
          return reply.code(400).send({ error: "Too many favorite fonts" });
        }
        db.addFavoriteFont(user, family, new Date().toISOString());
      }
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: FamilyParams }>(
    "/api/favorite-fonts/:family",
    { schema: { params: familyParams } },
    async (request, reply) => {
      db.removeFavoriteFont(userOf(request).id, request.params.family);
      return reply.code(204).send();
    },
  );

  // Image bytes are parsed only inside this plugin, so other routes still answer 415 to them.
  app.register(async (images) => {
    for (const contentType of IMAGE_CONTENT_TYPES) {
      images.addContentTypeParser(
        contentType,
        { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES },
        (_request, body, done) => done(null, body),
      );
    }

    images.post("/api/images", { bodyLimit: MAX_IMAGE_BYTES }, async (request, reply) => {
      const bytes = request.body as Buffer | undefined;
      if (!bytes || bytes.length === 0) return reply.code(400).send({ error: "Image is empty" });
      const type = detectImageType(bytes);
      if (!type) return reply.code(415).send({ error: "Unsupported image type" });
      const id = createHash("sha256").update(bytes).digest("hex");
      // Stored once per content; granted to the uploader even if someone else stored it first.
      db.insertImage({ id, type, data: bytes, created_at: new Date().toISOString() }, userOf(request).id);
      return reply.code(201).send({ url: `/api/images/${id}` });
    });
  });

  app.get<{ Params: IdParams }>("/api/images/:id", { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params;
    // Malformed, missing, or not this user's: the same 404, so nobody learns what others stored.
    const row = IMAGE_ID.test(id) ? db.getImage(id, userOf(request).id) : undefined;
    if (!row) return reply.code(404).send({ error: "Image not found" });
    // The browser keeps a copy but asks every time (an id's bytes never change, so the answer is
    // usually 304): a signed-out browser, or another user on it, can't show it from cache.
    reply.header("Cache-Control", "private, no-cache").header("ETag", `"${id}"`);
    if (request.headers["if-none-match"] === `"${id}"`) return reply.code(304).send();
    return reply
      .header("Content-Type", row.type)
      .header("X-Content-Type-Options", "nosniff")
      // Only raster types are ever stored; this is defense in depth if one is opened directly.
      .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .send(Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength));
  });

  return app;
}
