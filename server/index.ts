import { join, resolve } from "node:path";
import { buildApp } from "./app.ts";

// Empty values count as unset.
const port = Number(process.env.PORT || 5555);
const dataDir = process.env.DATA_DIR || "./data";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT "${process.env.PORT}": expected an integer from 1 to 65535.`);
  process.exit(1);
}

// The reverse proxy's addresses (IPs, CIDR ranges, proxy-addr keywords), comma-separated.
const trustProxy = process.env.TRUST_PROXY?.trim() || undefined;

let app: ReturnType<typeof buildApp>;
try {
  app = buildApp({
    dbPath: join(dataDir, "notes.db"),
    staticDir: resolve(import.meta.dirname, "../dist/web"),
    logger: true,
    trustProxy,
  });
} catch (err) {
  // An address list Fastify can't compile is the only setting that fails here.
  if (trustProxy === undefined) throw err;
  console.error(`Invalid TRUST_PROXY "${trustProxy}": ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

async function shutdown() {
  try {
    await app.close();
  } catch (err) {
    app.log.error(err);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

await app.listen({ port, host: "0.0.0.0" });
