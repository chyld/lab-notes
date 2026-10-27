import type { JSONContent } from "@tiptap/react";

export type NoteSummary = { id: string; title: string };

export type Note = {
  id: string;
  title: string;
  content: JSONContent;
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  return (await res.json()) as T;
}

const notePath = (id: string) => `/api/notes/${encodeURIComponent(id)}`;

export const listNotes = () => request<NoteSummary[]>("GET", "/api/notes");
export const getNote = (id: string) => request<Note>("GET", notePath(id));
export const createNote = (content: JSONContent) => request<Note>("POST", "/api/notes", { content });
export const updateNote = (id: string, content: JSONContent) => request<Note>("PUT", notePath(id), { content });
