/** Largest accepted image upload. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * Content types the upload route parses: any image/* (unsupported ones get a clear 415 after
 * detection) or untyped bytes. The stored type comes from the bytes, never the header.
 */
export const IMAGE_CONTENT_TYPES = [/^image\//, "application/octet-stream"];

const startsWith = (bytes: Uint8Array, prefix: number[], offset = 0) =>
  bytes.length >= offset + prefix.length && prefix.every((byte, i) => bytes[offset + i] === byte);

const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

/** The image's MIME type from its leading bytes, or null if it isn't PNG, JPEG, GIF, or WebP. */
export function detectImageType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}
