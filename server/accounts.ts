import { randomUUID } from "node:crypto";
import { hashPassword, normalizeUsername, passwordProblem, USERNAME } from "./auth.ts";
import type { AccountSummary, Db } from "./db.ts";

/** A problem to report to the person at the command line (one line). */
export class AccountError extends Error {}

/** The username as stored, or an AccountError saying why it can't be one. */
export function checkUsername(username: string): string {
  const name = normalizeUsername(username);
  if (!USERNAME.test(name)) {
    throw new AccountError(
      "A username is 1 to 40 characters: a-z and 0-9, then also . _ and - (it's lowercased).",
    );
  }
  return name;
}

export function checkPassword(password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new AccountError(problem);
}

/**
 * If an account added now would be the first, how many notes from before accounts it would get;
 * otherwise null (it starts empty).
 */
export function firstAccountClaim(db: Db): number | null {
  return db.countUsers() === 0 ? db.countUnownedNotes() : null;
}

/**
 * Creates an account. The first account also gets everything saved before accounts existed, in
 * the same transaction. Returns how many of those notes it got (0 for later accounts).
 */
export async function createAccount(db: Db, username: string, password: string): Promise<number> {
  const name = checkUsername(username);
  checkPassword(password);
  const hash = await hashPassword(password); // before the transaction: it takes a moment
  return db.immediate(() => {
    if (db.getUserByName(name)) throw new AccountError(`There's already an account named ${name}.`);
    const first = db.countUsers() === 0;
    const id = randomUUID();
    db.insertUser({ id, username: name, password_hash: hash, created_at: new Date().toISOString() });
    return first ? db.claimLegacyData(id) : 0;
  });
}

/** Sets a new password and signs the user out everywhere. */
export async function setPassword(db: Db, username: string, password: string) {
  const name = normalizeUsername(username);
  checkPassword(password);
  const hash = await hashPassword(password);
  db.immediate(() => {
    const user = db.getUserByName(name);
    if (!user) throw new AccountError(`There's no account named ${name}.`);
    db.setPasswordHash(user.id, hash);
    db.deleteUserSessions(user.id);
  });
}

export const listAccounts = (db: Db): AccountSummary[] => db.listAccounts();
