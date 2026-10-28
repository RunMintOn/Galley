import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startConsole } from "../src/server.ts";
import { startSessionInput } from "../src/session-input.mjs";

test("the live session bridge confirms literal input, rejects busy work and reports disconnection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-input-"));
  const root = join(directory, "project"); await mkdir(root);
  const service = await startConsole({ directory, token: "input-test" });
  let idle = true;
  const received: string[] = [];
  const bridge = await startSessionInput({ isIdle: () => idle, send(text) {
    received.push(text); idle = false; bridge.received({ role: "user", content: text + "\nextra context" });
  } });
  const api = async (path: string, body?: object) => {
    const response = await fetch(service.origin + "/api/" + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer input-test", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  try {
    await api("register", { cwd: root, sessionId: "live", bridge: { origin: bridge.origin, token: bridge.token } });
    const literal = "/skill:do-not-expand\n  中文输入  ";
    assert.equal((await api("input", { sessionId: "live", text: literal })).status, 200);
    assert.deepEqual(received, [literal]);
    assert.equal((await api("input", { sessionId: "live", text: "not queued" })).status, 409);
    assert.equal(received.length, 1);
    await bridge.close();
    for (let i = 0; i < 30; i++) {
      if ((await api("projects")).body.sessions[0].state === "offline") break;
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal((await api("input", { sessionId: "live", text: "offline" })).status, 503);
  } finally { await bridge.close(); await service.close(); }
});
