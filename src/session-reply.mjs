import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";

/** @typedef {{file: string, sessionId: string, entryId: string, sessionTitle?: string}} ReplyReference */
/** @typedef {{role: string, content?: string | Array<{type: string, text?: string}>}} ReplyMessage */

/** @param {string} payload @param {string} key */
function signature(payload, key) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** @param {ReplyReference} reference @param {string} origin @param {string} key */
export function createReplyUrl(reference, origin, key) {
  const payload = Buffer.from(JSON.stringify(reference)).toString("base64url");
  const hash = new URLSearchParams({ reply: payload, signature: signature(payload, key) });
  return new URL(`/#${hash}`, origin).href;
}

/** @param {URLSearchParams} params @param {string} key @returns {ReplyReference} */
export function parseReplyReference(params, key) {
  const payload = params.get("reply") || "";
  const supplied = Buffer.from(params.get("signature") || "", "base64url");
  const expected = Buffer.from(signature(payload, key), "base64url");
  // Only references issued by the extension may authorize reading a session file.
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid reply reference.");
  }
  const reference = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!reference || !["file", "sessionId", "entryId"].every((field) =>
    typeof reference[field] === "string" && reference[field].length > 0)) {
    throw new Error("Invalid reply reference.");
  }
  return reference;
}

/** @param {ReplyMessage} message */
export function replyMarkdown(message) {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content.filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text).join("\n\n");
}

/** @param {string} file */
async function* replyLines(file) {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(Math.min(size, 64 * 1024));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const boundary = bytesRead === size ? bytesRead : head.lastIndexOf(10, bytesRead - 1) + 1;
    if (!boundary) {
      // An unusually large header has no complete line in the first block.
      const input = createReadStream(file, { encoding: "utf8" });
      const lines = createInterface({ input, crlfDelay: Infinity });
      try { yield* lines; } finally { lines.close(); input.destroy(); }
      return;
    }
    // Keep the header check and early replies fast; most requested replies are
    // near one end. Only decode complete lines so split UTF-8 stays intact.
    yield* head.subarray(0, boundary).toString("utf8").split("\n");
    let end = size;
    let pending = Buffer.alloc(0);
    while (end > boundary) {
      const start = Math.max(boundary, end - 64 * 1024);
      const block = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(block, 0, block.length, start);
      if (bytesRead !== block.length) throw new Error("Pi session changed while reading.");
      const joined = Buffer.concat([block, pending]);
      let lineEnd = joined.length;
      for (let i = joined.length - 1; i >= 0; i--) {
        if (joined[i] !== 10) continue;
        yield joined.subarray(i + 1, lineEnd).toString("utf8");
        lineEnd = i;
      }
      pending = joined.subarray(0, lineEnd);
      end = start;
    }
    if (pending.length) yield pending.toString("utf8");
  } finally {
    await handle.close();
  }
}

/** @param {ReplyReference} reference */
export async function readReply({ file, sessionId, entryId }) {
  let unreadable = 0;
  let header = true;
  for await (const line of replyLines(file)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      // A bad line must not hide intact replies elsewhere in the same file.
      unreadable++;
      continue;
    }
    if (header) {
      if (entry.type !== "session" || entry.id !== sessionId) break;
      header = false;
    } else if (entry.id === entryId) {
      const text = entry.type === "message" ? replyMarkdown(entry.message) : "";
      if (text.trim()) return text;
      break;
    }
  }
  throw Object.assign(new Error(unreadable
    ? "Reply not found. Part of this Pi session file could not be read."
    : "Reply not found."), { unreadable: unreadable > 0 });
}

