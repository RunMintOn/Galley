import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startConsole } from "../src/server.ts";

test("workspace keeps index and working-tree changes separate, including special paths and unborn HEAD", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-workspace-"));
  const root = join(directory, "repo"); await mkdir(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-b", "main");
  const service = await startConsole({ directory, token: "workspace" });
  const api = async (op: string, params = {}) => {
    const r = await fetch(service.origin + "/api/git/" + op + "?" + new URLSearchParams({ root, ...params }), { headers: { Authorization: "Bearer workspace" } });
    const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); return value;
  };
  try {
    await fetch(service.origin + "/api/projects", { method: "POST", headers: { Authorization: "Bearer workspace", "Content-Type": "application/json" }, body: JSON.stringify({ root }) });
    const path = "带 空格\t换行\n.md";
    await writeFile(join(root, path), "first\n"); git("add", ".");
    assert.equal((await api("head")).branch, "main");
    assert.deepEqual((await api("log")).commits, []);
    assert.equal((await api("workspace-file", { group: "staged", path })).diff.addedLines, 1);
    git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "initial");
    await writeFile(join(root, path), "staged\n"); git("add", ".");
    await writeFile(join(root, path), "working\nextra\n");
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    await writeFile(join(root, ".gitignore"), "ignored\n");
    await writeFile(join(root, "ignored"), "not shown\n");
    const data = await api("workspace");
    assert.equal(data.count, 3);
    assert.equal(data.groups[0].files[0].path, path);
    assert.deepEqual([data.groups[0].added, data.groups[0].deleted], [1, 1]);
    assert.deepEqual([data.groups[1].added, data.groups[1].deleted], [2, 1]);
    assert.equal(data.groups[2].files.find((f: {path: string}) => f.path === "binary.bin").countable, false);
    const staged = await api("workspace-file", { group: "staged", path });
    const unstaged = await api("workspace-file", { group: "unstaged", path });
    assert.equal(staged.diff.blocks[0].lines.some((l: {content: string}) => l.content === "working"), false);
    assert.equal(unstaged.diff.blocks[0].lines.some((l: {type: string; content: string}) => l.type === "delete" && l.content === "staged"), true);
    git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "text and binary");
    const log = await api("log"); assert.equal(log.commits[0].unavailable, 1);
    await rename(join(root, path), join(root, "renamed.md")); git("add", "-A");
    assert.equal((await api("workspace")).groups[0].files[0].path, "renamed.md");
    const renameDiff = await api("workspace-file", {group:"staged",path:"renamed.md"});
    assert.equal(renameDiff.added, 0); assert.equal(renameDiff.deleted, 0);
    git("checkout", "--detach"); assert.equal((await api("head")).branch, "");
  } finally { await service.close(); }
});
