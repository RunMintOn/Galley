import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startConsole } from "../src/server.ts";

test("commit details return every diff without launching Git per file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-history-batch-"));
  const root = join(directory, "repo"); await mkdir(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-b", "main");
  for (let i = 0; i < 40; i++) await writeFile(join(root, `${i}.txt`), `${i}.txt before\n`);
  git("add", "."); git("-c", "user.name=T", "-c", "user.email=t@example.test", "commit", "-m", "before");
  for (let i = 0; i < 40; i++) await writeFile(join(root, `${i}.txt`), `${i}.txt after\n`);
  git("add", "."); git("-c", "user.name=T", "-c", "user.email=t@example.test", "commit", "-m", "after");
  const hash = git("rev-parse", "HEAD"), trace = join(directory, "git-trace.jsonl");
  const service = await startConsole({ directory, token: "batch" });
  const api = async (path: string, body?: object) => {
    const response = await fetch(service.origin + "/api/" + path, {
      method: body ? "POST" : "GET", headers: { Authorization: "Bearer batch", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const previousTrace = process.env.GIT_TRACE2_EVENT;
  try {
    await api("projects", { root });
    process.env.GIT_TRACE2_EVENT = trace;
    const result = await api("git/commit?" + new URLSearchParams({ root, hash }));
    assert.equal(result.files.length, 40);
    for (const file of result.files) {
      assert.equal(file.status, "Modified");
      assert.deepEqual([file.added, file.deleted], [1, 1]);
      assert.deepEqual(file.diff.blocks[0].lines.map((line: { content: string }) => line.content), [`${file.path} before`, `${file.path} after`]);
    }
    const commands = (await readFile(trace, "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(event => event.event === "start");
    assert.ok(commands.length <= 8, `40 个文件应批量读取，实际启动 ${commands.length} 次 Git`);
    const query = (hash: string, project = root) => api("git/commit?" + new URLSearchParams({ root: project, hash }));
    const first = await query(git("rev-parse", "HEAD^"));
    assert.equal(first.parent, null);
    assert.ok(first.files.every((file: { status: string; added: number }) => file.status === "Added" && file.added === 1));

    const scope = join(root, "scope"); await mkdir(scope);
    await writeFile(join(scope, "inside.md"), "scope only\n");
    git("add", "."); git("-c", "user.name=T", "-c", "user.email=t@example.test", "commit", "-m", "scoped");
    const unusual = "scope/改名\t\n.md";
    git("mv", "0.txt", unusual); git("mv", "scope/inside.md", "outside.md");
    await unlink(join(root, "1.txt"));
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 10, 255]));
    await writeFile(join(root, "invalid.txt"), Buffer.from([255, 254]));
    await writeFile(join(root, "large.txt"), "x".repeat(2 * 1024 * 1024 + 1));
    await writeFile(join(root, "empty.txt"), "");
    git("add", "."); git("-c", "user.name=T", "-c", "user.email=t@example.test", "commit", "-m", "edge cases");
    const edgeHash = git("rev-parse", "HEAD"), edge = await query(edgeHash);
    const files = new Map<string, any>(edge.files.map((file: { path: string }) => [file.path, file]));
    assert.equal(files.get(unusual).status, "Modified");
    assert.equal(files.get(unusual).notice, "原路径：0.txt");
    assert.deepEqual(files.get(unusual).diff.blocks, []);
    assert.deepEqual([files.get("1.txt").status, files.get("1.txt").deleted], ["Deleted", 1]);
    for (const path of ["binary.bin", "invalid.txt", "large.txt"]) assert.equal(files.get(path).status, "Unavailable");
    assert.match(files.get("binary.bin").notice, /二进制/);
    assert.match(files.get("invalid.txt").notice, /UTF-8/);
    assert.match(files.get("large.txt").notice, /2 MiB/);
    assert.deepEqual([files.get("empty.txt").status, files.get("empty.txt").diff.blocks], ["Added", []]);
    await api("projects", { root: scope });
    const scoped = await query(edgeHash, scope);
    assert.equal(scoped.files.length, 2);
    const added = scoped.files.find((file: { status: string }) => file.status === "Added");
    const deleted = scoped.files.find((file: { status: string }) => file.status === "Deleted");
    assert.deepEqual([added.path, added.added, added.diff.blocks[0].lines[0].content], ["改名\t\n.md", 1, "0.txt after"]);
    assert.deepEqual([deleted.path, deleted.deleted, deleted.diff.blocks[0].lines[0].content], ["inside.md", 1, "scope only"]);
  } finally {
    if (previousTrace === undefined) delete process.env.GIT_TRACE2_EVENT;
    else process.env.GIT_TRACE2_EVENT = previousTrace;
    await service.close();
  }
});
