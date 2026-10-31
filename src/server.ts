import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { watch, type FSWatcher } from "node:fs";
import { Store, ConsoleError } from "./store.ts";
import type { Registration, Round } from "./model.ts";
import { bearerToken, hasServiceHost, isCrossOrigin } from "./service-protocol.mjs";
import { createReplyUrl, parseReplyReference, readReply } from "./session-reply.mjs";
import { tree, readText, saveText, readImage, saveImage, projectPath, ignored } from "./files.ts";
import { createFileActions } from "./file-actions.ts";
import { gitQuery } from "./git.ts";
import { BUILD } from "./build.ts";

export const APP = "pi-review-console";
export const PROTOCOL = 1;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const same = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export async function jsonBody(request: IncomingMessage) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") throw new ConsoleError("Expected JSON", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 40 * 1024 * 1024) throw new ConsoleError("Request too large", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ConsoleError("Invalid JSON"); }
}
export function json(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}

export async function startConsole(options: { directory: string; port?: number; token?: string; web?: string }) {
  const token = options.token || randomUUID();
  const store = new Store(options.directory);
  await store.load();
  const files = createFileActions(store);
  const web = options.web || fileURLToPath(new URL("./web/", import.meta.url));
  const peers = new Set<WebSocket>();
  const watchers = new Map<WebSocket, { handles: FSWatcher[]; timer?: NodeJS.Timeout }>();
  function stopWatch(peer: WebSocket) {
    const active = watchers.get(peer);
    active?.handles.forEach(w => w.close());
    clearTimeout(active?.timer);
    watchers.delete(peer);
  }
  const bridges = new Map<string, { origin: string; token: string; controller: AbortController }>();
  const notify = (type: string, data?: unknown) => {
    const text = JSON.stringify({ type, data });
    for (const peer of peers) {
      if (peer.bufferedAmount > 1024 * 1024) peer.close();
      else peer.send(text);
    }
  };
  let origin = "";
  let port = 0;
  async function connect(input: Registration) {
    const session = await store.register(input);
    bridges.get(session.id)?.controller.abort();
    bridges.delete(session.id);
    session.state = "offline";
    if (!input.bridge) return;
    const target = new URL(input.bridge.origin);
    if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || !target.port || target.origin !== input.bridge.origin) {
      throw new ConsoleError("Invalid session bridge address");
    }
    const bridge = { ...input.bridge, controller: new AbortController() };
    bridges.set(session.id, bridge);
    void (async () => {
      try {
        const response = await fetch(bridge.origin + "/events", { headers: { Authorization: `Bearer ${bridge.token}` }, signal: bridge.controller.signal });
        if (!response.ok || !response.body) throw new Error("Session connection failed");
        let pending = "";
        for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
          pending += chunk;
          let boundary: number;
          while ((boundary = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            const data = frame.split("\n").find(line => line.startsWith("data: "))?.slice(6);
            if (!data) continue;
            const status = JSON.parse(data);
            session.state = status.busy ? "working" : "idle";
            session.error = status.error;
            notify("state");
          }
        }
      } catch { /* Disconnection is exposed below; no process scans or polling. */ }
      finally {
        if (bridges.get(session.id) === bridge) {
          bridges.delete(session.id);
          session.state = "offline";
          notify("state");
        }
      }
    })();
  }
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    // function-plot compiles the validated expression grammar; inline scripts remain blocked.
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
    if (!hasServiceHost(request, port) || isCrossOrigin(request, origin)) { json(response, { error: "Forbidden" }, 403); return; }
    try {
      const url = new URL(request.url || "/", origin);
      if (url.pathname === "/health") { json(response, { app: APP, protocol: PROTOCOL, build: BUILD }); return; }
      if (url.pathname.startsWith("/api/")) {
        if (!same(bearerToken(request), token)) throw new ConsoleError("Unauthorized", 403);
        if (url.pathname === "/api/auth" && request.method === "POST") {
          response.setHeader("Set-Cookie", `review=${token}; HttpOnly; SameSite=Strict; Path=/`);
          json(response, {}); return;
        }
        if (url.pathname === "/api/shutdown" && request.method === "POST") {
          json(response, {});
          setImmediate(async () => {
            bridges.forEach(b => b.controller.abort());
            peers.forEach(p => { stopWatch(p); p.terminate(); });
            socketServer.close(); server.close(); server.closeAllConnections();
          });
          return;
        }
        if (url.pathname === "/api/metrics" && request.method === "GET") {
          json(response, { watchers: [...watchers.values()].reduce((n, w) => n + w.handles.length, 0), rss: process.memoryUsage().rss }); return;
        }
        if (url.pathname.startsWith("/api/git/") && request.method === "GET") {
          json(response, await gitQuery(store, url.pathname.slice("/api/git/".length), url.searchParams)); return;
        }
        if (url.pathname === "/api/tree" && request.method === "GET") {
          json(response, await tree(store, url.searchParams.get("root") || "", url.searchParams.get("path") || "")); return;
        }
        if (url.pathname === "/api/files/search" && request.method === "GET") {
          json(response, { files: await files.search(url.searchParams.get("root") || "") }); return;
        }
        if (url.pathname === "/api/files/info" && request.method === "GET") {
          json(response, await files.info(url.searchParams.get("root") || "", url.searchParams.get("path") || "")); return;
        }
        if (url.pathname === "/api/files/action" && request.method === "POST") {
          const result = await files.perform(await jsonBody(request));
          notify("files"); json(response, result); return;
        }
        if (url.pathname === "/api/files/undo" && request.method === "POST") {
          const result = await files.undo((await jsonBody(request)).id);
          notify("files"); json(response, result); return;
        }
        if (url.pathname === "/api/files/system" && request.method === "POST") {
          const body = await jsonBody(request);
          json(response, await files.system(body.root, body.path || "", body.action)); return;
        }
        if (url.pathname === "/api/file" && request.method === "GET") {
          json(response, await readText(store, url.searchParams.get("root") || "", url.searchParams.get("path") || "", Number(url.searchParams.get("offset") || 0))); return;
        }
        if (url.pathname === "/api/file" && request.method === "PUT") {
          json(response, await saveText(store, await jsonBody(request))); return;
        }
        if (url.pathname === "/api/image" && request.method === "GET") {
          json(response, await readImage(store, url.searchParams.get("root") || "", url.searchParams.get("path") || "")); return;
        }
        if (url.pathname === "/api/image" && request.method === "POST") {
          json(response, await saveImage(store, await jsonBody(request))); return;
        }
        if (url.pathname === "/api/projects" && request.method === "GET") { json(response, { projects: store.projects, sessions: store.sessions }); return; }
        if (url.pathname === "/api/projects" && request.method === "POST") {
          const body = await jsonBody(request);
          const root = await store.addProject(body.root); notify("state"); json(response, { root }); return;
        }
        if (url.pathname === "/api/projects" && request.method === "DELETE") {
          const body = await jsonBody(request);
          store.projects = store.projects.filter(p => p.root !== body.root);
          await store.persist(); notify("state"); json(response, {}); return;
        }
        if (url.pathname === "/api/projects/order" && request.method === "POST") {
          const body = await jsonBody(request);
          if (!Array.isArray(body.roots) || body.roots.length !== store.projects.length ||
            new Set(body.roots).size !== store.projects.length ||
            body.roots.some((root: string) => !store.projects.some(p => p.root === root))) throw new ConsoleError("Invalid project order");
          store.projects = body.roots.map((root: string) => store.projects.find(p => p.root === root)!);
          await store.persist(); notify("state"); json(response, {}); return;
        }
        if (url.pathname === "/api/register" && request.method === "POST") {
          await connect(await jsonBody(request)); notify("state"); json(response, {}); return;
        }
        if (url.pathname === "/api/round" && request.method === "POST") {
          const round: Round = await jsonBody(request);
          round.end ??= round.report?.end || Date.now();
          await store.saveRound(round); notify("round", { sessionId: round.sessionId, id: round.id }); json(response, {}); return;
        }
        if (url.pathname === "/api/round" && request.method === "GET") {
          const sessionId = url.searchParams.get("session") || "";
          const round = await store.round(sessionId, url.searchParams.get("id") || "");
          const session = store.session(sessionId);
          let reply = "", replyError = "";
          if (round.entryId && session.file) {
            try {
              const signed = createReplyUrl({ file: session.file, sessionId, entryId: round.entryId }, origin, token);
              reply = await readReply(parseReplyReference(new URLSearchParams(new URL(signed).hash.slice(1)), token));
            } catch (e) { replyError = errorText(e); }
          }
          json(response, { ...round, reply, replyError }); return;
        }
        if (url.pathname === "/api/input" && request.method === "POST") {
          const body = await jsonBody(request);
          store.session(body.sessionId);
          const bridge = bridges.get(body.sessionId);
          if (!bridge) throw new ConsoleError("Session offline; draft kept", 503);
          const result = await fetch(bridge.origin + "/input", {
            method: "POST", headers: { Authorization: `Bearer ${bridge.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ text: body.text }), signal: AbortSignal.timeout(18000),
          });
          if (!result.ok) throw new ConsoleError(await result.text(), result.status);
          json(response, { confirmed: true }); return;
        }
        if (url.pathname === "/api/focus" && request.method === "POST") {
          const body = await jsonBody(request);
          const session = store.session(body.sessionId);
          notify("focus", { root: session.root, sessionId: session.id }); json(response, {}); return;
        }
        throw new ConsoleError("Endpoint not found", 404);
      }
      if (request.method !== "GET") throw new ConsoleError("Method not allowed", 405);
      const assets: Record<string, [string, string]> = {
        "/": ["index.html", "text/html; charset=utf-8"],
        "/app.js": ["app.js", "text/javascript"],
        "/bootstrap.js": ["bootstrap.js", "text/javascript"],
        "/style.css": ["style.css", "text/css"],
        "/scratch": ["scratch.html", "text/html; charset=utf-8"],
        "/scratch.js": ["scratch.js", "text/javascript"],
        "/scratch.css": ["scratch.css", "text/css"],
      };
      const asset = assets[url.pathname];
      if (!asset) throw new ConsoleError("Not found", 404);
      response.writeHead(200, { "Content-Type": asset[1] }).end(await readFile(join(web, asset[0])));
    } catch (e) {
      if (!response.headersSent) json(response, { error: errorText(e) }, e instanceof ConsoleError ? e.status : (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500);
      else response.destroy();
    }
  });
  const socketServer = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  server.on("upgrade", (request, socket, head) => {
    const cookie = request.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith("review="))?.slice(7) || "";
    if (request.url !== "/events" || !hasServiceHost(request, port) || isCrossOrigin(request, origin) || !same(cookie, token)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return;
    }
    socketServer.handleUpgrade(request, socket, head, peer => {
      peers.add(peer);
      peer.on("error", () => {});
      peer.on("close", () => { peers.delete(peer); stopWatch(peer); });
      peer.on("message", async raw => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.type !== "watch") return;
          stopWatch(peer);
          if (!message.root) return;
          const active = { handles: [] as FSWatcher[], timer: undefined as NodeJS.Timeout | undefined };
          watchers.set(peer, active);
          const paths = Array.isArray(message.paths) ? message.paths.slice(0, 64) : [""];
          for (const path of new Set<string>(paths)) {
            if (typeof path !== "string" || path.split(/[\\/]/).some(segment => ignored.has(segment))) continue;
            const actual = await projectPath(store, message.root, path);
            if (watchers.get(peer) !== active) return;
            const handle = watch(actual, (_type, file) => {
              if (file && ignored.has(String(file))) return;
              clearTimeout(active.timer);
              active.timer = setTimeout(() => {
                if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: "files", data: { root: message.root } }));
              }, 200);
            });
            handle.on("error", () => { stopWatch(peer); });
            active.handles.push(handle);
          }
        } catch (e) { stopWatch(peer); if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: "watch-error", data: errorText(e) })); }
      });
      peer.send(JSON.stringify({ type: "state" }));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port || 0, "127.0.0.1", resolve); });
  port = (server.address() as import("node:net").AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  return {
    origin, token,
    async close() {
      bridges.forEach(b => b.controller.abort());
      peers.forEach(p => { stopWatch(p); p.terminate(); });
      socketServer.close();
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    },
  };
}

if (process.argv[1]) {
  // A bundled server is also the standalone launcher. Imports in tests do not start it.
  if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const directory = process.env.REVIEW_CONSOLE_STATE || join(process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || "", ".pi/agent"), "review-console");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let previous: { origin?: string; token?: string } = {};
    try { previous = JSON.parse(await readFile(join(directory, "service.json"), "utf8")); } catch { /* First start. */ }
    const preferredPort = Number(process.env.REVIEW_CONSOLE_PORT || (previous.origin ? new URL(previous.origin).port : 0));
    let service;
    try { service = await startConsole({ directory, port: preferredPort, token: process.env.REVIEW_CONSOLE_TOKEN || previous.token }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      service = await startConsole({ directory, token: process.env.REVIEW_CONSOLE_TOKEN || previous.token });
    }
    await writeFile(join(directory, "service.json"), JSON.stringify({ origin: service.origin, token: service.token, pid: process.pid }), { mode: 0o600 });
    console.log(`${service.origin}/#token=${service.token}`);
  }
}
