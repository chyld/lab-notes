import { join, resolve } from "node:path";
import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? "./data";

const app = buildApp({
  dbPath: join(dataDir, "notes.db"),
  staticDir: resolve(import.meta.dirname, "../dist/web"),
  logger: true,
});

async function shutdown() {
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

await app.listen({ port, host: "0.0.0.0" });
