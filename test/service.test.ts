import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, readFile } from "node:fs/promises";
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

test("project order survives and two sessions retain distinct rounds", async () => {
  const f = await fixture();
  try {
    const other = join(f.directory, "other"); await mkdir(other);
    await f.api("/api/register", { cwd: f.root, sessionId: "one" });
    await f.api("/api/register", { cwd: f.root, sessionId: "two" });
    await f.api("/api/projects", { root: other });
    for (const sessionId of ["one", "two"]) for (const id of ["first", "second"]) {
      await f.api("/api/round", { sessionId, id, outcome: "completed", notice: sessionId + ":" + id, end: id === "first" ? 1 : 2 });
    }
    const list = (await f.api("/api/projects")).body;
    assert.equal(list.sessions.length, 2);
    const order = list.projects.map((p: { root: string }) => p.root).reverse();
    assert.equal((await f.api("/api/projects/order", { roots: order })).status, 200);
    assert.deepEqual((await f.api("/api/projects")).body.projects.map((p: { root: string }) => p.root), order);
    assert.equal((await f.api("/api/round?session=one&id=first")).body.notice, "one:first");
    assert.equal((await f.api("/api/round?session=two&id=first")).body.notice, "two:first");
    assert.equal((await f.api("/api/projects", { root: order[1] }, "DELETE")).status, 200);
    assert.equal((await f.api("/api/round?session=one&id=first")).status, 404);
  } finally { await f.service.close(); }
});

test("files save only by explicit request and reject stale versions or escaped paths", async () => {
  const f = await fixture();
  try {
    await f.api("/api/projects", { root: f.root });
    await writeFile(join(f.root, "doc.md"), "original\n");
    const query = "/api/file?root=" + encodeURIComponent(f.root) + "&path=doc.md";
    const original = await f.api(query);
    assert.equal(original.status, 200);
    assert.equal(original.body.content, "original\n");
    await writeFile(join(f.root, "doc.md"), "agent change\n");
    assert.equal((await f.api("/api/file", { root: f.root, path: "doc.md", version: original.body.version, content: "my draft\n" }, "PUT")).status, 409);
    assert.equal(await readFile(join(f.root, "doc.md"), "utf8"), "agent change\n");
    const fresh = await f.api(query);
    assert.equal((await f.api("/api/file", { root: f.root, path: "doc.md", version: fresh.body.version, content: "my draft\n" }, "PUT")).status, 200);
    assert.equal((await f.api(query)).body.content, "my draft\n");
    await writeFile(join(f.directory, "outside"), "private");
    await symlink(join(f.directory, "outside"), join(f.root, "escape"));
    assert.equal((await f.api("/api/file?root=" + encodeURIComponent(f.root) + "&path=escape")).status, 403);
    assert.equal((await f.api("/api/file?root=" + encodeURIComponent(f.root) + "&path=../outside")).status, 403);
    await mkdir(join(f.root, "node_modules"));
    const tree = await f.api("/api/tree?root=" + encodeURIComponent(f.root));
    assert.ok(tree.body.entries.some((e: { name: string }) => e.name === "doc.md"));
    assert.ok(!tree.body.entries.some((e: { name: string }) => e.name === "node_modules"));
    await writeFile(join(f.root, "large.txt"), "bounded\n".repeat(400000));
    const large = await f.api("/api/file?root=" + encodeURIComponent(f.root) + "&path=large.txt");
    assert.equal(large.body.partial, true);
    assert.ok(large.body.content.length < 300000);
    assert.ok(large.body.nextOffset > 0);
  } finally { await f.service.close(); }
});
