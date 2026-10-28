import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startConsole } from "../src/server.ts";

test("history diffs use commit parents and historical files never use the working tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-git-"));
  const root = join(directory, "repo"); await mkdir(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-b", "main");
  await writeFile(join(root, "note.md"), "first\n");
  git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "first");
  const first = git("rev-parse", "HEAD");
  await writeFile(join(root, "note.md"), "second\n");
  git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "second");
  const second = git("rev-parse", "HEAD");
  await writeFile(join(root, "note.md"), "uncommitted\n");
  const service = await startConsole({ directory, token: "git-test" });
  const api = async (path: string, body?: object) => {
    const r = await fetch(service.origin + "/api/" + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer git-test", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  try {
    await api("projects", { root });
    const query = "root=" + encodeURIComponent(root);
    const log = await api("git/log?" + query);
    assert.equal(log.status, 200);
    assert.deepEqual(log.body.commits.map((c: { subject: string }) => c.subject), ["second", "first"]);
    const rootCommit = await api("git/commit?" + query + "&hash=" + first);
    assert.equal(rootCommit.body.parent, null);
    assert.equal(rootCommit.body.files[0].status, "Added");
    const commit = await api("git/commit?" + query + "&hash=" + second);
    assert.equal(commit.body.parent, first);
    assert.equal(commit.body.files[0].diff.deletedLines, 1);
    const old = await api("git/file?" + query + "&hash=" + first + "&path=note.md");
    assert.equal(old.body.content, "first\n");
    assert.ok((await api("git/refs?" + query)).body.refs.some((r: { name: string }) => r.name === "main"));
    assert.match((await api("git/blame?" + query + "&hash=" + first + "&path=note.md")).body.text, /first/);
    assert.equal((await api("git/file?" + query + "&hash=--help&path=note.md")).status, 400);
    assert.equal(git("diff", "--", "note.md").includes("+uncommitted"), true);
    await writeFile(join(root, "note.md"), "second\n");
    git("checkout", "-b", "feature", first);
    await writeFile(join(root, "side.md"), "side\n"); git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "side");
    const side = git("rev-parse", "HEAD");
    git("checkout", "main");
    git("-c", "user.name=Test", "-c", "user.email=test@example.test", "merge", "--no-ff", "feature", "-m", "merge");
    const merged = git("rev-parse", "HEAD");
    const merge = await api("git/commit?" + query + "&hash=" + merged);
    assert.deepEqual(merge.body.parents, [second, side]);
    assert.equal(merge.body.parent, second);
    assert.equal((await api("git/commit?" + query + "&hash=" + merged + "&parent=1")).body.parent, side);
  } finally { await service.close(); }
});
