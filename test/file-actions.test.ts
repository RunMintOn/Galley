import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { createFileActions } from "../src/file-actions.ts";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "galley-files-"));
  const root = join(directory, "project"), other = join(directory, "other");
  await mkdir(root); await mkdir(other);
  const store = new Store(join(directory, "state"));
  await store.load(); await store.addProject(root); await store.addProject(other);
  return { root, other, actions: createFileActions(store) };
}

test("create, copy and cross-project move keep contents and undo the last move", async () => {
  const { root, other, actions } = await fixture();
  await actions.perform({ action: "folder", root, parent: "", name: "notes" });
  await actions.perform({ action: "file", root, parent: "notes", name: "draft.md" });
  await writeFile(join(root, "notes/draft.md"), "# Draft");
  await actions.perform({ action: "copy", root, path: "notes/draft.md", targetRoot: other, parent: "" });
  assert.equal(await readFile(join(other, "draft.md"), "utf8"), "# Draft");
  const moved = await actions.perform({ action: "move", root, path: "notes", targetRoot: other, parent: "", name: "archive" });
  await assert.rejects(access(join(root, "notes")));
  assert.equal(await readFile(join(other, "archive/draft.md"), "utf8"), "# Draft");
  await actions.undo(moved.undo);
  assert.equal(await readFile(join(root, "notes/draft.md"), "utf8"), "# Draft");
  await assert.rejects(access(join(other, "archive")));
});

test("name conflicts never overwrite and a changed file cannot be undone", async () => {
  const { root, actions } = await fixture();
  await writeFile(join(root, "a.txt"), "original");
  await writeFile(join(root, "b.txt"), "keep");
  await assert.rejects(actions.perform({ action: "rename", root, path: "a.txt", name: "b.txt" }), /already exists/);
  assert.equal(await readFile(join(root, "b.txt"), "utf8"), "keep");
  const renamed = await actions.perform({ action: "rename", root, path: "a.txt", name: "renamed.txt" });
  await writeFile(join(root, "renamed.txt"), "changed afterwards");
  await assert.rejects(actions.undo(renamed.undo), /changed/);
  assert.equal(await readFile(join(root, "renamed.txt"), "utf8"), "changed afterwards");
});

test("search includes unopened dot directories but excludes generated folders", async () => {
  const { root, actions } = await fixture();
  await mkdir(join(root, ".scratch/deep"), { recursive: true });
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, ".scratch/deep/spec.md"), "spec");
  await writeFile(join(root, "node_modules/hidden.js"), "hidden");
  assert.deepEqual(await actions.search(root), [".scratch/deep/spec.md"]);
  await assert.rejects(actions.perform({ action: "file", root, parent: "", name: "../outside" }), /name/);
});

test("trash uses the system wastebasket and undo restores the original path", { skip: process.platform !== "darwin" }, async () => {
  const { root, actions } = await fixture();
  await writeFile(join(root, "discard.txt"), "restore me");
  const result = await actions.perform({ action: "trash", root, path: "discard.txt" });
  await assert.rejects(access(join(root, "discard.txt")));
  await actions.undo(result.undo);
  assert.equal(await readFile(join(root, "discard.txt"), "utf8"), "restore me");
});
