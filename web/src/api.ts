import type { JSONContent } from "@tiptap/react";

export type NoteSummary = { id: string; title: string; tags: string[]; updatedAt: string };

export type Note = {
  id: string;
  title: string;
  content: JSONContent;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Who this tab signed in as. Sent with every request: if someone else has signed in on this
// browser since (the cookie changed underneath), the server refuses (409) instead of letting this
// tab read or write the other account.
let tabUser: string | null = null;

export function setTabUser(username: string) {
  tabUser = username;
}

function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return send<T>(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (tabUser) headers.set("X-Lab-Notes-User", tabUser);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data: unknown = await res.json();
      if (typeof data === "object" && data !== null && "error" in data && typeof data.error === "string") {
        message = data.error;
      }
    } catch {
      // Not JSON; keep the generic message.
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T; // no body to parse
  return (await res.json()) as T;
}

export type AuthStatus = { username: string | null; hasAccounts: boolean };

export const authStatus = () => request<AuthStatus>("GET", "/api/auth/status");
export const signIn = (username: string, password: string) =>
  request<{ username: string }>("POST", "/api/auth/login", { username, password });

const notePath = (id: string) => `/api/notes/${encodeURIComponent(id)}`;

/** Every note, or with `q` only those matching it (words in the text, `#tag` prefixes). */
export const listNotes = (q = "") =>
  request<NoteSummary[]>("GET", q.trim() ? `/api/notes?q=${encodeURIComponent(q)}` : "/api/notes");
export const getNote = (id: string) => request<Note>("GET", notePath(id));
export const createNote = (content: JSONContent, tags: string[]) =>
  request<Note>("POST", "/api/notes", { content, tags });
export const updateNote = (id: string, content: JSONContent, tags: string[]) =>
  request<Note>("PUT", notePath(id), { content, tags });

const favoritePath = (family: string) => `/api/favorite-fonts/${encodeURIComponent(family)}`;

/** Favorite font families, in the order added. */
export const listFavoriteFonts = () => request<string[]>("GET", "/api/favorite-fonts");
export const addFavoriteFont = (family: string) => request<void>("PUT", favoritePath(family));
export const removeFavoriteFont = (family: string) => request<void>("DELETE", favoritePath(family));

/** Stores the image's bytes; resolves to its URL (`/api/images/<sha256>`). */
export const uploadImage = (file: Blob) =>
  send<{ url: string }>("/api/images", { method: "POST", headers: { "Content-Type": file.type }, body: file }).then(
    (res) => res.url,
  );
