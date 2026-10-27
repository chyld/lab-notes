import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import Fastify, { type FastifyError } from "fastify";
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
      required: ["type"],
      properties: {
        type: { const: "doc" },
        content: { type: "array", items: { type: "object" } },
      },
    },
  },
} as const;

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

type DocBody = { content: { type: "doc"; content?: object[] } };
type IdParams = { id: string };

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
  const app = Fastify({ logger, ajv: { customOptions: { coerceTypes: false } } });
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

  const serveStatic = staticDir !== undefined && existsSync(staticDir);
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
      const updated = db.updateNote(id, extractTitle(content), JSON.stringify(content), new Date().toISOString());
      if (!updated) return reply.code(404).send({ error: "Note not found" });
      return toNote(db.getNote(id)!);
    },
  );

  return app;
}
