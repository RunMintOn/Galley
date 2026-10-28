import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { bearerToken, hasServiceHost, serviceOrigin } from "./service-protocol.mjs";

/** @param {import("node:http").IncomingMessage} request */
export async function readInputBody(request) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new Error("Expected JSON.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Input is too large (maximum 1 MiB).");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// Pi's `input` handlers may rewrite a message before it is recorded, so the
// receipt accepts appended context rather than requiring byte equality. A
// shorter or wholly rewritten message cannot safely identify this submission.
/** @param {string} received @param {string} sent */
export function matchesReceipt(received, sent) {
  /** @param {string} text */
  const normalize = (text) => String(text).replace(/\r\n/g, "\n").trim();
  const a = normalize(received);
  const b = normalize(sent);
  return !!b && a.startsWith(b);
}

// This server lives in the original Pi process, not in the detached preview service.
/** @param {{isIdle: () => boolean, send: (text: string) => void}} options */
export async function startSessionInput({ isIdle, send }) {
  const token = randomUUID();
  /** @type {Set<import("node:http").ServerResponse>} */
  const listeners = new Set();
  /** @type {{text: string, response: import("node:http").ServerResponse, timer: NodeJS.Timeout} | undefined} */
  let pending;
  let error = "";
  let closed = false;

  /** @param {unknown} reason */
  const messageOf = (reason) => reason instanceof Error ? reason.message : String(reason);
  const status = () => `event: status\ndata: ${JSON.stringify({ busy: !!pending || !isIdle(), error })}\n\n`;
  /** @param {string} [reason] */
  const update = (reason) => {
    if (reason !== undefined) error = reason;
    for (const listener of listeners) if (!listener.write(status())) listener.destroy();
  };
  /** @param {number} code @param {string} [reason] */
  const finish = (code, reason = "") => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.response.writeHead(code).end(reason);
    pending = undefined;
    update(reason);
  };
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const port = server.address();
    if (closed || !hasServiceHost(request, typeof port === "object" && port ? port.port : 0) ||
      bearerToken(request) !== token || request.headers.origin) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (request.url === "/events" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
      response.write(status());
      listeners.add(response);
      response.on("close", () => listeners.delete(response));
      return;
    }
    if (request.url !== "/input" || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    let text;
    try {
      ({ text } = await readInputBody(request));
      if (typeof text !== "string" || !text.trim()) throw new Error("Enter a message.");
    } catch (reason) {
      response.writeHead(400).end(messageOf(reason));
      return;
    }
    if (closed) {
      response.writeHead(503).end("Pi disconnected. Your draft has been kept.");
      return;
    }
    // Check here as well as in the browser: terminal input or another page can win the race.
    if (pending || !isIdle()) {
      response.writeHead(409).end("Pi is working. Your draft has been kept.");
      return;
    }
    pending = {
      text, response,
      timer: setTimeout(() => finish(504,
        "Pi did not confirm receipt. Check the terminal before resending; your draft has been kept."), 15000),
    };
    // Releasing the slot when the client goes away keeps a retry from being told
    // Pi is busy while it is idle. Pi's own idle check still guards a real resend.
    response.on("close", () => {
      if (pending?.response !== response) return;
      clearTimeout(pending.timer);
      pending = undefined;
      update("");
    });
    update("");
    try {
      send(text);
    } catch (reason) {
      finish(502, messageOf(reason));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  const origin = serviceOrigin(typeof address === "object" && address ? address.port : 0);
  return {
    origin, token, update,
    /** @param {import("./session-reply.mjs").ReplyMessage} message */
    received(message) {
      if (!pending || message.role !== "user") return;
      const text = typeof message.content === "string" ? message.content :
        (message.content || []).filter((part) => part.type === "text").map((part) => part.text).join("");
      if (matchesReceipt(text, pending.text)) finish(204);
    },
    /** @param {boolean} aborted */
    settled(aborted) {
      if (pending) finish(502, "Pi finished without confirming this submission. Check the terminal before resending; your draft has been kept.");
      update(aborted ? "Stopped in Pi." : undefined);
    },
    async close() {
      if (closed) return;
      closed = true;
      finish(503, "Pi disconnected. Your draft has been kept.");
      server.close();
      server.closeAllConnections();
    },
  };
}

