import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startConsole } from "../src/server.ts";

let service, browser, root, directory;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=";
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "review-editor-"));
  root = join(directory, "project"); await mkdir(root);
  await writeFile(join(root, "SKILL.md"), "# Skill\n\n![local](photo.png)\n");
  await writeFile(join(root, "photo.png"), Buffer.from(png, "base64"));
  service = await startConsole({ directory: join(directory, "state"), token: "editor", web: resolve("dist/web") });
  await fetch(service.origin + "/api/projects", { method: "POST", headers: { Authorization: "Bearer editor", "Content-Type": "application/json" }, body: JSON.stringify({ root }) });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  await mkdir("test-results/editor", { recursive: true });
});
after(async () => { await browser?.close(); await service?.close(); });

test("file-tree Markdown previews images, honors the default, and keeps reply content separate", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(service.origin + "/#token=editor");
    await page.locator(".files-footer").waitFor();
    assert.ok((await page.locator(".files-footer").boundingBox()).height <= 32, "文件栏底部保持单行入口");
    await page.locator(".files-footer").screenshot({ path: "test-results/editor/files-footer.png" });
    await page.locator('#tree [data-path="SKILL.md"]').click();
    await page.locator('.file-views [data-view="preview"]').click();
    await page.locator(".file-preview h1").waitFor();
    assert.equal(await page.locator(".file-preview h1").innerText(), "Skill");
    await page.waitForFunction(() => document.querySelector(".file-preview img")?.naturalWidth === 1);
    assert.equal(await page.locator("#document").innerText(), "No replies yet");
    await page.click("#settings-menu > summary");
    await page.locator("#settings-menu .popover").screenshot({ path: "test-results/editor/preview-options.png" });
    await page.click('label.check:has(#default-preview)');
    await page.click("#settings-menu > summary");
    await page.reload();
    await page.locator('#tree [data-path="SKILL.md"]').click();
    await page.locator(".file-preview h1").waitFor();
    assert.equal(await page.locator(".file-view .editor-host").isVisible(), false);
    await page.screenshot({ path: "test-results/editor/review-dark.png" });
    await page.locator('.file-views [data-view="split"]').click();
    assert.equal(await page.locator(".file-view .editor-host").isVisible(), true);
    await page.click("#settings-menu > summary");
    await page.click('[data-setting="theme"] [data-value="light"]');
    await page.click("#settings-menu > summary");
    await page.screenshot({ path: "test-results/editor/review-light.png" });
  } finally { await context.close(); }
});

test("file source mode does not render a hidden preview and shows the latest draft when reopened", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(service.origin + "/#token=editor");
    await page.locator('#tree [data-path="SKILL.md"]').click();
    await page.locator('.file-views [data-view="split"]').click();
    await page.locator(".file-preview h1").waitFor();
    await page.locator('.file-views [data-view="source"]').click();
    await page.getByRole("textbox", { name: "File content", exact: true }).fill("# Latest draft\n");
    // The previous implementation schedules a hidden render after 150ms.
    await page.waitForTimeout(250);
    assert.equal(await page.locator(".file-preview h1").textContent(), "Skill");
    await page.locator('.file-views [data-view="preview"]').click();
    assert.equal(await page.locator(".file-preview h1").textContent(), "Latest draft");
  } finally { await context.close(); }
});

test("reply divider drags, persists, folds and fits a narrow window", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(service.origin + "/#token=editor");
    const divider = page.locator('.resizer[data-edge="reply"]');
    await divider.waitFor();
    const before = await page.locator("#reply-pane").boundingBox();
    const box = await divider.boundingBox();
    await page.mouse.move(box.x + 4, 300); await page.mouse.down();
    await page.mouse.move(box.x - 140, 300); await page.mouse.up();
    const after = await page.locator("#reply-pane").boundingBox();
    assert.ok(after.width > before.width + 100);
    await page.reload();
    await divider.waitFor();
    assert.ok(Math.abs((await page.locator("#reply-pane").boundingBox()).width - after.width) < 2);
    await page.click('#content-pane > header [data-collapse="content-pane"]');
    assert.equal(await divider.isVisible(), false);
    await page.click("#content-pane > .rail-button");
    assert.equal(await divider.isVisible(), true);
    await page.setViewportSize({ width: 950, height: 600 });
    await page.waitForFunction(() => document.querySelector("#reply-pane").getBoundingClientRect().right <= innerWidth);
    await page.screenshot({ path: "test-results/editor/narrow.png" });
  } finally { await context.close(); }
});

// The browser exercises the real UI and IPC contract without opening native
// dialogs or moving desktop focus. Native disk behavior is covered in Go tests.
async function desktopPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  const disk = new Map();
  let pickPath = "/documents/Notes.md", closeChoice = 2, writes = [];
  disk.set("/documents/Existing.md", { path: "/documents/Existing.md", content: "# Existing\n\n![photo](photo.png)", version: "v1" });
  await page.exposeFunction("nativeCall", async (name, ...args) => {
    const method = name.replace("Desktop.", "");
    if (method === "PendingDocuments") return [];
    if (method === "PickDocuments") return [disk.get("/documents/Existing.md")];
    if (method === "PickSavePath") return pickPath;
    if (method === "ConfirmClose") return closeChoice;
    if (method === "ReadDocument") return disk.get(args[0]);
    if (method === "ReadImage") return "data:image/png;base64," + png;
    if (method === "RebaseImagePaths") return args[2].map(s => s);
    if (method === "WriteDocument") {
      const input = args[0], old = disk.get(input.path);
      if (input.version && old?.version !== input.version) throw new Error("The file changed on disk");
      writes.push(input);
      const result = { path: input.path, content: input.content, version: "v" + (writes.length + 1) };
      disk.set(input.path, result); return result;
    }
    throw new Error(method);
  });
  await page.addInitScript(() => { window.mygo = { call: (...args) => window.nativeCall(...args) }; });
  await page.goto(service.origin + "/scratch");
  return { context, page, disk, writes, pick: value => pickPath = value, close: value => closeChoice = value };
}

test("new document pastes a JPEG, previews immediately, then saves Markdown and its resource", async () => {
  const ui = await desktopPage(), { page } = ui;
  try {
    await page.click("#new-doc");
    const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
    await source.fill("# Pasted image\n");
    await source.press("ControlOrMeta+End");
    await source.evaluate(el => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2;
      canvas.getContext("2d").fillRect(0, 0, 2, 2);
      const bytes = Uint8Array.from(atob(canvas.toDataURL("image/jpeg").split(",")[1]), c => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "clipboard.jpg", { type: "image/jpeg" }));
      el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: data }));
    });
    await page.waitForFunction(() => document.querySelector("#scratch-source").textContent.includes("attachment:"));
    await page.waitForFunction(() => document.querySelector(".scratch-preview img")?.naturalWidth === 2);
    ui.pick(""); await page.evaluate(() => window.reviewDesktop.command("save"));
    assert.equal(ui.writes.length, 0, "cancelling the save dialog must keep the draft");
    ui.pick("/documents/Notes.md"); await page.evaluate(() => window.reviewDesktop.command("save"));
    assert.equal(ui.writes.length, 1);
    assert.match(ui.writes[0].content, /!\[Image\]\(Notes\.assets\/image-.*\.jpg\)/);
    assert.ok(ui.writes[0].images[0].data.startsWith("/9j/"), "persist the JPEG rather than treating it as text");
    assert.equal(await page.locator(".unsaved-dot").count(), 0);
    await source.press("End"); await source.press("X");
    ui.close(2); await page.locator(".tab-close").click();
    assert.equal(await page.getByRole("tab").count(), 1);
    ui.close(0); await page.locator(".tab-close").click();
    assert.equal(await page.getByRole("tab").count(), 0);
    assert.equal(ui.writes.length, 2);
  } finally { await ui.context.close(); }
});

test("opened files support preview, save-as, search/replace and external changes", async () => {
  const ui = await desktopPage(), { page } = ui;
  try {
    await page.click("#settings-menu > summary");
    await page.click('label.check:has(#default-preview)');
    await page.click("#settings-menu > summary");
    await page.click("#open-doc");
    await page.locator(".scratch-preview h1").waitFor();
    assert.equal(await page.locator("#scratch-source").count(), 0);
    await page.evaluate(() => window.reviewDesktop.command("find"));
    const search = page.locator(".cm-search input[name=search]");
    await search.fill("Existing");
    await page.locator(".cm-search input[name=replace]").fill("Changed");
    await page.locator(".cm-search button[name=replaceAll]").click();
    await page.evaluate(() => window.reviewDesktop.command("save"));
    assert.match(ui.writes[0].content, /# Changed/);
    ui.pick("/documents/Copy.md");
    await page.evaluate(() => window.reviewDesktop.command("save-as"));
    assert.equal(ui.writes[1].path, "/documents/Copy.md");
    ui.disk.set("/documents/Copy.md", { path: "/documents/Copy.md", content: "# External", version: "outside" });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => document.querySelector("#scratch-source")?.textContent.includes("External"));
    const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
    await source.fill("# Local draft");
    ui.disk.set("/documents/Copy.md", { path: "/documents/Copy.md", content: "# Another external", version: "outside2" });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => document.querySelector("#scratch-status").textContent.includes("changed on disk"));
    assert.equal(await source.innerText(), "# Local draft");
    page.once("dialog", d => d.dismiss());
    await page.evaluate(() => window.reviewDesktop.command("save"));
    assert.equal(ui.disk.get("/documents/Copy.md").content, "# Another external");
    await source.fill("# Markdown 文件编辑\n\n直接编辑本地文件，预览与源码保持一致。\n\n## 图片与资源\n\n粘贴的图片保存在 **文档旁的资源目录**，已有图片使用相对路径。\n\n![示例图片](photo.png)\n\n- 打开与保存\n- 查找和替换\n- 外部修改提示\n\n```js\nconst document = { title: \"Notes\", saved: true };\n```\n\n> 保留简单的文件操作，不改变审查台的工作流程。\n");
    await page.click('[data-view="split"]');
    await page.locator(".scratch-preview h1").waitFor();
    await page.screenshot({ path: "test-results/editor/source-dark.png" });
    await page.click("#settings-menu > summary");
    await page.click('[data-setting="theme"] [data-value="light"]');
    await page.click("#settings-menu > summary");
    await page.screenshot({ path: "test-results/editor/source-light.png" });
  } finally { await ui.context.close(); }
});
