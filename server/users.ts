// The accounts command line (see SPEC "Accounts and sign-in"):
//   node server/users.ts add <username>
//   node server/users.ts passwd <username>
//   node server/users.ts list
// In Docker: docker compose exec app node server/users.ts …
import { join } from "node:path";
import { AccountError, checkPassword, checkUsername, createAccount, firstAccountClaim, listAccounts, setPassword } from "./accounts.ts";
import { openDb } from "./db.ts";

const USAGE = `Usage:
  node server/users.ts add <username>      create an account (asks for the password)
  node server/users.ts passwd <username>   set a new password (signs that user out everywhere)
  node server/users.ts list                list the accounts

Passwords are asked for, never given as arguments. Piped input: the first line is the password.`;

/** Exits with code 130 from Ctrl+C at a prompt (raw mode turns it into a byte, not a signal). */
class Interrupted extends Error {}

/** Typed after the end of one answer, for the next question. */
let leftover = "";

/**
 * Reads a password without echoing it. With a terminal: raw mode (restored on every way out);
 * Enter ends it, Backspace removes the last character, Ctrl+C aborts, Ctrl+D ends it, and pasted
 * text arrives in chunks and is taken whole. Without one: the first line of stdin.
 */
async function askPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return firstLine();
  // Echo off before the prompt shows: a fast paste can't land while it's still on.
  stdin.setRawMode(true);
  try {
    process.stderr.write(prompt);
    stdin.resume();
    stdin.setEncoding("utf8");
    return await new Promise<string>((resolve, reject) => {
      let typed = "";
      // Feeds typed characters; true once the answer is complete. Whatever came after the line's
      // end (a paste of both answers at once) is kept for the next question.
      const feed = (text: string): boolean => {
        const chars = [...text];
        for (let i = 0; i < chars.length; i++) {
          const char = chars[i];
          if (char === "\r" || char === "\n" || char === "\u0004") {
            const rest = chars.slice(char === "\r" && chars[i + 1] === "\n" ? i + 2 : i + 1);
            leftover = rest.join("");
            stdin.off("data", onData);
            process.stderr.write("\n");
            resolve(typed);
            return true;
          }
          if (char === "\u0003") {
            stdin.off("data", onData);
            process.stderr.write("\n");
            reject(new Interrupted());
            return true;
          }
          if (char === "\u007f" || char === "\b") typed = [...typed].slice(0, -1).join("");
          else typed += char;
        }
        return false;
      };
      const onData = (chunk: string) => {
        feed(chunk);
      };
      stdin.on("data", onData);
      const pending = leftover;
      leftover = "";
      if (pending) feed(pending);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

// Piped: answers as soon as a line arrives (the pipe may stay open, e.g. `docker compose exec -T`
// typed into), keeping what came after it for a next question.
let buffered = "";
let ended = false;
function firstLine(): Promise<string> {
  const stdin = process.stdin;
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    const take = () => {
      const newline = buffered.indexOf("\n");
      if (newline < 0 && !ended) return false;
      const line = newline < 0 ? buffered : buffered.slice(0, newline);
      buffered = newline < 0 ? "" : buffered.slice(newline + 1);
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.pause();
      // Only the line ending is stripped; spaces are part of the password.
      resolve(line.replace(/\r$/, ""));
      return true;
    };
    const onData = (chunk: string) => {
      buffered += chunk;
      take();
    };
    const onEnd = () => {
      ended = true;
      take();
    };
    if (take()) return;
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.resume();
  });
}

/** Asks twice with a terminal (a typo would lock you out), once when piped. */
async function newPassword(): Promise<string> {
  const password = await askPassword("Password: ");
  checkPassword(password);
  if (process.stdin.isTTY && (await askPassword("Again: ")) !== password) {
    throw new AccountError("The two passwords don't match.");
  }
  return password;
}

async function confirm(question: string): Promise<boolean> {
  process.stderr.write(question);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  // Ctrl+D (end of input) is a "no".
  const answer = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => resolve(String(data)));
    process.stdin.once("end", () => resolve(""));
  });
  process.stdin.pause();
  return /^\s*y(es)?\s*$/i.test(answer);
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function main(args: string[]): Promise<number> {
  const [command, name, ...extra] = args;
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (command === "list") {
    if (name !== undefined) throw new AccountError("list takes no arguments.");
  } else if (command === "add" || command === "passwd") {
    if (name === undefined) throw new AccountError(`${command} needs a username.`);
    if (extra.length > 0) throw new AccountError(`${command} takes one username (and never a password).`);
  } else {
    throw new AccountError(`Unknown command "${command}". Try --help.`);
  }

  const db = openDb(join(process.env.DATA_DIR || "./data", "notes.db"));
  try {
    if (command === "list") {
      const accounts = listAccounts(db);
      if (accounts.length === 0) console.log("No accounts yet.");
      for (const account of accounts) {
        console.log(`${account.username}  created ${account.created_at.slice(0, 10)}  ${plural(account.notes, "note")}`);
      }
      return 0;
    }

    if (command === "add") {
      const username = checkUsername(name);
      // The first account inherits what was saved before accounts existed: with a terminal, ask,
      // so a typo can't hand it to the wrong name.
      const claim = firstAccountClaim(db);
      if (claim !== null && process.stdin.isTTY) {
        const ok = await confirm(
          `${username} will be the first account and own the ${plural(claim, "existing note")}. Continue? [y/N] `,
        );
        if (!ok) {
          console.error("Nothing created.");
          return 1;
        }
      }
      const password = await newPassword();
      // What the transaction did, not what was true before the prompts (another add may have won).
      const created = await createAccount(db, username, password);
      console.log(created.first ? `Created ${username} (${plural(created.notes, "existing note")}).` : `Created ${username}.`);
      return 0;
    }

    const password = await newPassword();
    await setPassword(db, name, password);
    console.log(`New password set for ${name.trim().toLowerCase()}; signed out everywhere.`);
    return 0;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof Interrupted) {
      process.exitCode = 130;
    } else if (err instanceof AccountError) {
      console.error(err.message);
      process.exitCode = 1;
    } else {
      throw err;
    }
  }
}
