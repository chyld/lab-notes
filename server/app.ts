import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify, { LogController, type FastifyError, type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import { openDb, type NoteRow } from "./db.ts";
import { extractTitle } from "./title.ts";

export type AppOptions = {
  dbPath: string;
  staticDir?: string;
  logger?: boolean;
};

const docBody = {
  type: "object",
  required: ["content"],
  properties: {
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

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

type DocBody = { content: { type: "doc"; content: object[] } };
type IdParams = { id: string };

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

function toNote(row: NoteRow) {
  return {
    id: row.id,
    title: row.title,
    content: JSON.parse(row.content) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildApp({ dbPath, staticDir, logger = false }: AppOptions) {
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
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

  app.get("/api/notes", async () => db.listNotes());

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
      const updated = db.updateNote(id, extractTitle(content), JSON.stringify(content), new Date().toISOString());
      if (!updated) return reply.code(404).send({ error: "Note not found" });
      return toNote(db.getNote(id)!);
    },
  );

  return app;
}
