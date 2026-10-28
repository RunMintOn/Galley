import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startConsole } from "../src/server.ts";

export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "review-test-"));
  const root = join(directory, "project");
  await mkdir(root);
  const service = await startConsole({ directory, port: 0, token: "test-secret" });
  const api = async (path: string, body?: unknown, method = body ? "POST" : "GET") => {
    const response = await fetch(service.origin + path, {
      method, headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { directory, root, service, api };
}

test("a completed round keeps its report and original reply paired after reconnect", async () => {
  const f = await fixture();
  try {
    const sessionFile = join(f.directory, "session.jsonl");
    await writeFile(sessionFile, [
      { type: "session", id: "session-a" },
      { type: "message", id: "answer-1", message: { role: "assistant", content: [{ type: "text", text: "# 原始回复\n\n完成了。" }] } },
    ].map(x => JSON.stringify(x)).join("\n") + "\n");
    await f.api("/api/register", { cwd: f.root, sessionId: "session-a", file: sessionFile, title: "会话 A" });
    const report = { id: "report-1", cwd: f.root, start: 1, end: 2, outcome: "completed", prompts: ["修改"], files: [], added: 0, deleted: 0 };
    assert.equal((await f.api("/api/round", { sessionId: "session-a", id: "round-1", entryId: "answer-1", report, outcome: "completed" })).status, 200);
    const result = await f.api("/api/round?session=session-a&id=round-1");
    assert.equal(result.body.reply, "# 原始回复\n\n完成了。");
    assert.equal(result.body.report.id, "report-1");
    assert.equal((await fetch(f.service.origin + "/api/projects")).status, 403);
    assert.equal((await fetch(f.service.origin + "/api/projects", { headers: { Authorization: "Bearer test-secret", Origin: "https://evil.test" } })).status, 403);
  } finally { await f.service.close(); }
});
