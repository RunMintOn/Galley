import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";

const directory = await mkdtemp(join(tmpdir(), "review-document-poll-"));
const state = join(directory, "state"), socket = join(directory, "automation.sock");
const app = resolve("dist-desktop-test/Galley Test.app/Contents/MacOS/Galley");
const log = await open(join(directory, "app.log"), "w");
const targets = [];
const content = ("A document for external change checks.\n".repeat(8000)).slice(0, 256 * 1024);
for (let i = 0; i < 20; i++) {
  const path = join(directory, `note-${i}.md`);
  await writeFile(path, content);
  targets.push({ path, version: createHash("sha256").update(content).digest("hex") });
}
const child = spawn(app, [], {
  env: { ...process.env, REVIEW_CONSOLE_STATE: state, REVIEW_CONSOLE_DESKTOP_TEST: "1", MYGO_AUTOMATION: socket },
  stdio: ["ignore", log.fd, log.fd],
});
const wait = async fn => {
  let last;
  for (let i = 0; i < 100; i++) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw last || new Error("Document poll wait timed out");
};
let connection, service;
const result = { mode: "baseline", files: targets.length, fileBytes: Buffer.byteLength(content), samples: [], note: "Research only, deferred priority. Real isolated WKWebView and Desktop bridge; three unchanged checks via ReadDocument, as scratch recheck currently does. No real Agent, dialogs or user documents. Text byte counts exclude JSON escaping/envelopes." };
try {
  connection = await wait(() => new Promise((resolve, reject) => {
    const client = net.createConnection(socket);
    client.once("connect", () => resolve(client));
    client.once("error", reject);
  }));
  let buffer = "", id = 0;
  const pending = new Map();
  connection.on("data", chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
      }
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id; pending.set(current, { resolve, reject });
    connection.write(JSON.stringify({ id: current, method, params }) + "\n");
  });
  const evaluate = async (window, script) => (await call("eval", { window, script })).value;
  service = await wait(async () => JSON.parse(await readFile(join(state, "service.json"), "utf8")));
  const main = await wait(async () => {
    const window = (await call("windows")).windows[0];
    return window && await evaluate(window.id, "!!window.reviewDesktop") && window;
  });
  for (let i = 0; i < 3; i++) {
    const sample = await evaluate(main.id, `(async () => {
      const targets = ${JSON.stringify(targets)};
      const start = performance.now();
      const updates = [];
      for (const target of targets) updates.push(await window.mygo.call("Desktop.ReadDocument", target.path));
      return { durationMs: performance.now() - start, bridgeCalls: targets.length, returnedTextBytes: updates.reduce((sum, doc) => sum + new TextEncoder().encode(doc.content || "").length, 0), updates: updates.length };
    })()`);
    result.samples.push(sample);
  }
  assert.ok(result.samples.every(sample => sample.returnedTextBytes === targets.length * Buffer.byteLength(content)));
  await call("menu", { window: main.id, path: ["File", "Quit Galley"] });
  await wait(() => child.exitCode !== null);
} finally {
  await mkdir("test-results/performance", { recursive: true });
  await writeFile("test-results/performance/documents-before.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  connection?.destroy();
  if (child.exitCode === null) child.kill("SIGTERM");
  if (service) await fetch(service.origin + "/api/shutdown", { method: "POST", headers: { Authorization: `Bearer ${service.token}` } }).catch(() => {});
  await log.close();
}
