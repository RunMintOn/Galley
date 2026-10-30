import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startConsole } from "../src/server.ts";
import { rebaseImages } from "../web-src/images.js";

test("save-as rebases Markdown images but never rewrites code examples", async () => {
  const source = '![photo](old/photo.png "caption")\n\n[id]: <old/my photo.jpg>\n\n`![inline](old/photo.png)`\n\n```md\n![example](old/photo.png)\n```\n';
  const result = await rebaseImages(source, async (paths: string[]) => {
    assert.deepEqual(paths, ["old/photo.png", "<old/my photo.jpg>"]);
    return ["../old/photo.png", "<../old/my%20photo.jpg>"];
  });
  assert.equal(result, '![photo](../old/photo.png "caption")\n\n[id]: <../old/my%20photo.jpg>\n\n`![inline](old/photo.png)`\n\n```md\n![example](old/photo.png)\n```\n');
});

test("project images round-trip through authenticated routes within the project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-images-"));
  const root = join(directory, "project"); await mkdir(root);
  await writeFile(join(root, "README.md"), "# Images");
  await writeFile(join(directory, "outside.png"), "outside");
  const service = await startConsole({ directory, token: "images" });
  const headers = { Authorization: "Bearer images", "Content-Type": "application/json" };
  try {
    await fetch(service.origin + "/api/projects", { method: "POST", headers, body: JSON.stringify({ root }) });
    const saved = await fetch(service.origin + "/api/image", { method: "POST", headers,
      body: JSON.stringify({ root, path: "README.md", type: "image/jpeg", data: Buffer.from("jpeg bytes").toString("base64") }) });
    assert.equal(saved.status, 200);
    const { source } = await saved.json();
    assert.match(source, /^README\.assets\/image-.*\.jpg$/);
    const image = await fetch(service.origin + "/api/image?" + new URLSearchParams({ root, path: source }), { headers });
    assert.deepEqual(await image.json(), { url: "data:image/jpeg;base64," + Buffer.from("jpeg bytes").toString("base64") });
    const outside = await fetch(service.origin + "/api/image?" + new URLSearchParams({ root, path: "../outside.png" }), { headers });
    assert.equal(outside.status, 403);
    const unauthorized = await fetch(service.origin + "/api/image?" + new URLSearchParams({ root, path: source }));
    assert.equal(unauthorized.status, 403);
  } finally { await service.close(); }
});
