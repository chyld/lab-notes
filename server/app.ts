import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify, { LogController, type FastifyError, type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import { openDb, type NoteListRow, type NoteRow } from "./db.ts";
import { detectImageType, IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "./images.ts";
import { isEmptyQuery, matchesQuery, parseQuery } from "./search.ts";
import { extractText, extractTitle } from "./title.ts";

export type AppOptions = {
  dbPath: string;
  staticDir?: string;
  logger?: boolean;
};

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

export function buildApp({ dbPath, staticDir, logger = false }: AppOptions) {
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    // Raw (still %-encoded) length: a 100-character family name with spaces is longer encoded.
    routerOptions: { maxParamLength: 300 },
    ajv: { customOptions: { coerceTypes: false } },
    // Errors raised before routing (e.g. a malformed %-escape) also use the { error } shape.
    frameworkErrors: (err, _request, reply) => {
      (reply as FastifyReply).code(err.statusCode ?? 400).send({ error: err.message });
    },
  });
  const db = openDb(dbPath);
  app.addHook("onClose", async () => db.close());

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
    const isApi = path === "/api" || path.startsWith("/api/");
    const isFile = /\.[^/]*$/.test(path);
    if (serveStatic && isRead && !isApi && !isFile) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });

  const toSummary = (row: NoteListRow) => ({
    id: row.id,
    title: row.title,
    tags: JSON.parse(row.tags) as string[],
    updatedAt: row.updated_at,
  });

  // ?q= searches (see SPEC "Search"); blank or absent lists every note.
  app.get<{ Querystring: { q?: string } }>("/api/notes", { schema: { querystring: listQuery } }, async (request) => {
    const query = parseQuery(request.query.q ?? "");
    if (isEmptyQuery(query)) return db.listNotes().map(toSummary);
    // Only word searches need every note's text; tag-only searches use the plain list.
    const rows = query.words.length > 0 ? db.searchableNotes() : db.listNotes().map((row) => ({ ...row, body: "" }));
    return rows
      .map((row) => ({ row, tags: JSON.parse(row.tags) as string[] }))
      .filter(({ row, tags }) => matchesQuery({ body: row.body, tags }, query))
      .map(({ row }) => toSummary(row));
  });

  app.get<{ Params: IdParams }>("/api/notes/:id", { schema: { params: idParams } }, async (request, reply) => {
    const row = db.getNote(request.params.id);
    if (!row) return reply.code(404).send({ error: "Note not found" });
    return toNote(row);
  });

  app.post<{ Body: DocBody }>("/api/notes", { schema: { body: docBody } }, async (request, reply) => {
    if (exceedsMaxDepth(request.body.content)) return reply.code(400).send(tooDeep);
    const now = new Date().toISOString();
    const row: NoteRow = {
      id: randomUUID(),
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
      const content = request.body.content;
      if (exceedsMaxDepth(content)) return reply.code(400).send(tooDeep);
      const tags = request.body.tags === undefined ? null : JSON.stringify(request.body.tags);
      const updated = db.updateNote(
        id,
        extractTitle(content),
        JSON.stringify(content),
        extractText(content),
        tags,
        new Date().toISOString(),
      );
      if (!updated) return reply.code(404).send({ error: "Note not found" });
      return toNote(db.getNote(id)!);
    },
  );

  app.get("/api/favorite-fonts", async () => db.listFavoriteFonts());

  app.put<{ Params: FamilyParams }>(
    "/api/favorite-fonts/:family",
    { schema: { params: familyParams } },
    async (request, reply) => {
      const { family } = request.params;
      // Synchronous check and insert, so no other request can slip in between.
      if (!db.isFavoriteFont(family)) {
        if (db.countFavoriteFonts() >= MAX_FAVORITE_FONTS) {
          return reply.code(400).send({ error: "Too many favorite fonts" });
        }
        db.addFavoriteFont(family, new Date().toISOString());
      }
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: FamilyParams }>(
    "/api/favorite-fonts/:family",
    { schema: { params: familyParams } },
    async (request, reply) => {
      db.removeFavoriteFont(request.params.family);
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
      db.insertImage({ id, type, data: bytes, created_at: new Date().toISOString() });
      return reply.code(201).send({ url: `/api/images/${id}` });
    });
  });

  app.get<{ Params: IdParams }>("/api/images/:id", { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params;
    const row = IMAGE_ID.test(id) ? db.getImage(id) : undefined;
    if (!row) return reply.code(404).send({ error: "Image not found" });
    return reply
      .header("Content-Type", row.type)
      // An id is the hash of its bytes, so they never change.
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      // Only raster types are ever stored; this is defense in depth if one is opened directly.
      .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .send(Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength));
  });

  return app;
}
