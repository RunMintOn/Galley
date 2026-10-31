import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { startConsole } from "../src/server.ts";

let service, browser, root, other;
before(async () => {
  const directory = await mkdtemp(join(tmpdir(), "galley-explorer-ui-"));
  root = join(directory, "project"); other = join(directory, "other");
  await mkdir(join(root, "notes/deep"), { recursive: true }); await mkdir(other);
  await writeFile(join(root, "notes/deep/spec.md"), "# Spec");
  await writeFile(join(root, "readme.md"), "# Read me");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  service = await startConsole({ directory: join(directory, "state"), token: "explorer", web: resolve("dist/web") });
  for (const path of [root, other]) {
    const response = await fetch(service.origin + "/api/projects", { method: "POST", headers: { Authorization: "Bearer explorer", "Content-Type": "application/json" }, body: JSON.stringify({ root: path }) });
    const added = await response.json();
    if (path === root) root = added.root; else other = added.root;
  }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  await mkdir("test-results/file-explorer", { recursive: true });
});
after(async () => { await browser?.close(); await service?.close(); });

async function pageForTest() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(service.origin + "/#token=explorer");
  await page.locator('#tree [data-path="readme.md"]').waitFor();
  return { context, page, errors };
}
const row = (page, path) => page.locator(`#tree [data-path="${path}"]`);
async function menu(page, path, label) {
  await row(page, path).click({ button: "right" });
  await page.locator("#file-context").getByRole("menuitem", { name: label, exact: true }).click();
}
async function name(page, value) {
  await page.locator(".tree-name-input").fill(value);
  await page.locator(".tree-name-input").press("Enter");
  await page.locator(".tree-name-input").waitFor({ state: "detached" });
}

test("create, rename with a draft, copy, move and trash are usable and undoable", async () => {
  const { context, page, errors } = await pageForTest();
  try {
    await page.locator("#new-file").click(); await name(page, "draft.md");
    await page.locator(".cm-content[contenteditable=true]").fill("# Unsaved draft");
    await menu(page, "draft.md", "Rename"); await name(page, "renamed.md");
    assert.equal(await page.locator(".cm-content").innerText(), "# Unsaved draft");
    await page.keyboard.press("Meta+s");
    await page.waitForFunction(() => document.querySelector(".file-state")?.textContent.includes("manual save"));
    assert.equal(await readFile(join(root, "renamed.md"), "utf8"), "# Unsaved draft");
    await page.locator("#notice-undo").waitFor({ state: "hidden" });
    await menu(page, "renamed.md", "Copy");
    await menu(page, "notes", "Paste");
    await row(page, "notes/renamed.md").waitFor();
    assert.equal(await readFile(join(root, "notes/renamed.md"), "utf8"), "# Unsaved draft");
    await page.locator("#notice-undo").click();
    await row(page, "notes/renamed.md").waitFor({ state: "detached" });
    await menu(page, "renamed.md", "Cut"); await menu(page, "notes", "Paste");
    await row(page, "notes/renamed.md").waitFor();
    await row(page, "renamed.md").waitFor({ state: "detached" });
    assert.equal(await page.locator("#content-name").getAttribute("title"), "notes/renamed.md");
    await page.locator("#notice-undo").click();
    await row(page, "renamed.md").waitFor();
    await menu(page, "renamed.md", "Move to Trash");
    await row(page, "renamed.md").waitFor({ state: "detached" });
    await page.locator("#notice-undo").click();
    await row(page, "renamed.md").waitFor();
    assert.equal(await readFile(join(root, "renamed.md"), "utf8"), "# Unsaved draft");
    assert.equal(await page.locator("#content-name").getAttribute("title"), "renamed.md");
    await row(page, "notes").click({ button: "right" });
    await page.locator("#file-context").waitFor();
    await page.screenshot({ path: "test-results/file-explorer/context-dark.png" });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("quick open searches unopened folders and tree/pane state survives reload", async () => {
  const { context, page, errors } = await pageForTest();
  try {
    assert.equal(await row(page, "readme.md").evaluate(element => getComputedStyle(element).opacity), "1");
    await page.keyboard.press("Meta+p");
    await page.locator("#file-query").fill("deep/spec");
    await page.locator("#file-results button").filter({ hasText: "spec.md" }).waitFor();
    await page.screenshot({ path: "test-results/file-explorer/quick-open.png" });
    await page.locator("#file-query").press("Enter");
    await page.locator("#reveal-file").click();
    await row(page, "notes/deep/spec.md").waitFor();
    assert.equal(await page.locator("#tree .tree-dir > div").first().evaluate(element => getComputedStyle(element).borderLeftWidth), "1px");
    await page.locator('#reply-pane > header [data-collapse="reply-pane"]').click();
    await page.reload();
    await row(page, "notes/deep/spec.md").waitFor();
    assert.equal(await page.locator("#reply-pane").evaluate(element => element.classList.contains("collapsed")), true);
    await page.locator("#collapse-tree").click();
    await row(page, "notes/deep/spec.md").waitFor({ state: "detached" });
    await page.setViewportSize({ width: 950, height: 600 });
    await page.locator("#new-folder").click(); await name(page, "new-folder");
    await row(page, "new-folder").waitFor();
    await page.screenshot({ path: "test-results/file-explorer/narrow.png" });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("focus refresh retains the branch row and files can be pasted across projects", async () => {
  const { context, page, errors } = await pageForTest();
  try {
    const project = page.locator(".project").filter({ has: page.locator(".project-name", { hasText: "project" }) });
    await project.locator(".branch").waitFor();
    const before = await project.boundingBox();
    await page.route("**/api/git/head?**", async route => {
      await new Promise(resolve => setTimeout(resolve, 120));
      await route.continue();
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    assert.equal((await project.boundingBox()).height, before.height);
    assert.equal(await project.locator(".branch").innerText(), "main");
    await menu(page, "readme.md", "Copy");
    await page.locator(`.project[data-root="${other}"]`).click();
    await page.locator("#tree .tree-empty").waitFor();
    await page.locator("#tree").click({ button: "right" });
    await page.locator("#file-context").getByRole("menuitem", { name: "Paste", exact: true }).click();
    await row(page, "readme.md").waitFor();
    assert.equal(await readFile(join(other, "readme.md"), "utf8"), "# Read me");
    await page.keyboard.press("Meta+z");
    await row(page, "readme.md").waitFor({ state: "detached" });
    await page.locator(`.project[data-root="${root}"]`).click();
    await page.locator("#history-tab").click();
    await page.locator(".workspace-dir").first().waitFor();
    assert.equal(await page.locator(".workspace-dir > div").first().evaluate(element => getComputedStyle(element).borderLeftWidth), "1px");
    await page.screenshot({ path: "test-results/file-explorer/git-tree.png" });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("collapsed rails expand from their lower area and project menus stay within the window", async () => {
  const { context, page, errors } = await pageForTest();
  try {
    for (const id of ["projects-pane", "files-pane", "content-pane", "reply-pane"]) {
      const pane = page.locator("#" + id);
      await pane.locator(`header [data-collapse="${id}"]`).click();
      const rail = pane.locator(":scope > .rail-button"), box = await rail.boundingBox();
      assert.equal(box.height, (await pane.boundingBox()).height, id + " has a full-height hit area");
      const glyph = await rail.locator("svg").boundingBox();
      assert.ok(Math.abs(glyph.y + glyph.height / 2 - 20) <= 1, id + " expand icon stays on the header line: " + JSON.stringify(glyph));
      await page.mouse.click(box.x + box.width / 2, box.y + box.height - 60);
      assert.equal(await pane.evaluate(element => element.classList.contains("collapsed")), false);
    }
    await row(page, "notes").click();
    await row(page, "notes/deep").waitFor();
    assert.equal(await page.locator('#tree summary use[href="#i-chevron"]').count(), 0);
    assert.equal(await row(page, "readme.md").locator(".file-icon").getAttribute("data-type"), "markdown");
    const divider = page.locator('.resizer[data-edge="projects"]');
    await divider.focus();
    for (let index = 0; index < 4; index++) await divider.press("ArrowLeft");
    await page.locator("#project-menu > summary").click();
    const menu = await page.locator("#project-menu .menu-items").boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= 1440, "project actions remain inside the viewport");
    await page.screenshot({ path: "test-results/file-explorer/rails-menu-folders.png" });
    await page.locator("#project-menu > summary").click();
    await page.locator("#history-tab").click();
    await page.locator(".workspace-dir").first().waitFor();
    assert.equal(await page.locator('.workspace-dir > summary use[href="#i-chevron"]').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
