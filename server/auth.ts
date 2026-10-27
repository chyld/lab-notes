import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Passwords: scrypt with N = 2^15, r = 8, p = 1. Those need exactly 32 MiB, Node's default limit,
// and the call fails at the limit, so maxmem is raised.
const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 1024;
export const USERNAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export const SESSION_COOKIE = "lab_notes_session";
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** A session is re-stamped (and its cookie re-sent) at most this often. */
const TOUCH_MS = 60 * 60 * 1000;

/** Trimmed and lowercased: `Chyld` signs in as `chyld`. */
export const normalizeUsername = (username: string) => username.trim().toLowerCase();

/** The same password typed on a Mac (decomposed accents) or elsewhere hashes the same. */
const normalizePassword = (password: string) => password.normalize("NFC");

/** Why a password can't be used, or null. Lengths count characters (code points). */
export function passwordProblem(password: string): string | null {
  const length = [...normalizePassword(password)].length;
  if (length < MIN_PASSWORD) return `The password needs at least ${MIN_PASSWORD} characters.`;
  if (length > MAX_PASSWORD) return `The password can have at most ${MAX_PASSWORD} characters.`;
  return null;
}

// At most 4 hashes at once (each holds 32 MiB); more wait their turn. A finished hash hands its
// slot straight to the next one waiting, so nothing can slip in between.
const MAX_HASHING = 4;
let hashing = 0;
const waiting: (() => void)[] = [];

async function acquire() {
  if (hashing < MAX_HASHING) hashing += 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else hashing -= 1;
}

async function derive(password: string, salt: Buffer, options: ScryptOptions, length: number): Promise<Buffer> {
  await acquire();
  try {
    return await new Promise((resolve, reject) =>
      scrypt(normalizePassword(password), salt, length, { ...options, maxmem: MAXMEM }, (err, key) =>
        err ? reject(err) : resolve(key),
      ),
    );
  } finally {
    release();
  }
}

/** `scrypt$N$r$p$<salt>$<hash>` (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P }, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Recomputes with the stored parameters; false for anything malformed. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!expected.length || !Object.values(params).every((v) => Number.isInteger(v) && v > 0)) return false;
  try {
    const key = await derive(password, Buffer.from(salt, "base64"), params, expected.length);
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// A sign-in for a username that doesn't exist still runs one scrypt, against this (made once, with
// the same parameters), so the response time doesn't tell which usernames exist.
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("base64"));
  return dummyHash;
}

/** A new session token (for the cookie) and its hash (for the database). */
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Still valid at `now`? */
export const sessionAlive = (lastSeenAt: string, now: number) => Date.parse(lastSeenAt) + SESSION_MS > now;

/** Due for a new `last_seen_at` (and a re-sent cookie)? */
export const sessionStale = (lastSeenAt: string, now: number) => Date.parse(lastSeenAt) + TOUCH_MS < now;

/** Anything last seen before this is expired. */
export const expiryCutoff = (now: number) => new Date(now - SESSION_MS).toISOString();

/** The session token from a `Cookie` header, if there's one that could be ours. */
export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  return null;
}

/** The `Set-Cookie` value: the session's token, or (null) clearing it. */
export function sessionCookie(token: string | null, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token ?? ""}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${token ? SESSION_MS / 1000 : 0}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Sign-in attempts that haven't succeeded, per client IP, in a sliding window. An attempt is
 * counted before its password check (parallel requests can't all slip under the limit) and
 * uncounted if it succeeds. Capped at `maxKeys` IPs, the least recently used dropped.
 */
export class SignInLimiter {
  private attempts = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(limit = 10, windowMs = 15 * 60 * 1000, maxKeys = 10_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** Counts an attempt; returns a function that uncounts it, or null if over the limit. */
  begin(ip: string, now = Date.now()): (() => void) | null {
    const recent = (this.attempts.get(ip) ?? []).filter((time) => time > now - this.windowMs);
    this.attempts.delete(ip); // re-inserted below: the map's order is least recently used first
    if (recent.length >= this.limit) {
      this.attempts.set(ip, recent);
      return null;
    }
    recent.push(now);
    this.attempts.set(ip, recent);
    while (this.attempts.size > this.maxKeys) this.attempts.delete(this.attempts.keys().next().value!);
    return () => {
      const times = this.attempts.get(ip);
      const index = times?.indexOf(now) ?? -1;
      if (times && index >= 0) times.splice(index, 1);
    };
  }
}
