import { addFavoriteFont, listFavoriteFonts, removeFavoriteFont } from "./api.ts";

// Every favorites request waits for the one before it: writes reach the server in the order they
// were made (a quick star-unstar can't arrive reversed), and a fetch sees every earlier write.
// Module-level, so it outlives the font popover: a write still finishes after the popover closes.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined); // a failure doesn't stop the requests after it
  return run;
}

export const fetchFavoriteFonts = () => enqueue(listFavoriteFonts);

export const saveFavoriteFont = (family: string, favorite: boolean) =>
  enqueue(() => (favorite ? addFavoriteFont(family) : removeFavoriteFont(family)));

// The last list the picker had: the next open shows it at once, until its own fetch answers, so an
// unchanged list doesn't jump.
let cached: string[] = [];

export const cachedFavoriteFonts = () => cached;

export function setCachedFavoriteFonts(list: string[]) {
  cached = list;
}
