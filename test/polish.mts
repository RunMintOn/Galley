import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startConsole } from "../src/server.ts";

let service, browser, context, directory;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "review-polish-"));
  service = await startConsole({ directory, token: "polish", web: resolve("dist/web") });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
});
after(async () => { for (const page of context?.pages() || []) await page.close({ runBeforeUnload: false }); await browser?.close(); await service?.close(); });

test("browser Add folder opens the path prompt", async () => {
  const page = await context.newPage();
  await page.goto(service.origin + "/#token=polish");
  await page.locator(".pane-toggle svg").first().waitFor();
  const dialog = page.waitForEvent("dialog", { timeout: 2000 }).then(async prompt => {
    assert.equal(prompt.type(), "prompt");
    await prompt.dismiss();
  });
  await page.click("#add-project");
  await dialog;
  await page.close();
});

test("all panes fit the 950px window before and after resizing or folding", async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 950, height: 700 });
  await page.goto(service.origin + "/#token=polish");
  await page.locator(".pane-toggle svg").first().waitFor();
  const fits = async () => assert.ok(await page.locator("#reply-pane").evaluate(el =>
    el.getBoundingClientRect().right <= innerWidth), "回复栏不能被窗口右边缘裁切");
  await fits();
  await page.click(".files-pane .pane-toggle");
  await page.click(".files-pane .rail-button");
  await fits();
  await page.setViewportSize({ width: 1440, height: 900 });
  await fits();
  await page.setViewportSize({ width: 950, height: 700 });
  await fits();
  await page.close();
});

test("pane arrows point inward when expanding and outward when collapsing", async () => {
  const page = await context.newPage();
  await page.goto(service.origin + "/#token=polish");
  await page.locator(".pane-toggle svg").first().waitFor();
  for (const [pane, collapseDirection] of [["projects", 1], ["reply", -1]]) {
    const direction = selector => page.locator(selector + " svg").evaluate(el =>
      new DOMMatrix(getComputedStyle(el).transform).a);
    const toggle = `.${pane}-pane .pane-toggle`, rail = `.${pane}-pane .rail-button`;
    assert.equal(await direction(toggle), collapseDirection);
    await page.click(toggle);
    assert.equal(await direction(rail), -collapseDirection);
    await page.click(rail);
    assert.equal(await direction(toggle), collapseDirection);
  }
  await page.close();
});

test("scratch source wraps logical lines without extra line numbers", async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto(service.origin + "/scratch");
  await page.click("#new-doc");
  const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
  const text = "# 标题\n" + "这是一段需要软换行的长文本。".repeat(25) + "\n第三行";
  await source.fill(text);
  await page.locator(".scratch-preview h1").waitFor();
  assert.equal(await page.locator(".cm-lineNumbers").count(), 1, "源码应显示行号");
  const numbers = await page.locator(".cm-lineNumbers .cm-gutterElement:visible").allTextContents();
  assert.deepEqual(numbers.filter(n => n.trim()), ["1", "2", "3"]);
  assert.ok(await page.locator(".cm-line").nth(1).evaluate(el =>
    el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).lineHeight) * 2));
  assert.ok(await page.locator(".cm-scroller").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.close({ runBeforeUnload: false });
});

test("scratch tabs and preview switches retain selection and undo history", async () => {
  const page = await context.newPage();
  await page.goto(service.origin + "/scratch");
  await page.click("#new-doc");
  const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
  await source.fill("alpha");
  await source.press("ArrowLeft");
  await page.click("#new-doc");
  await source.fill("beta");
  await page.getByRole("tab").first().click();
  await page.click('[data-view="preview"]');
  await page.click("#settings-menu > summary");
  await page.click('[data-setting="font"] [data-value="mono"]');
  await page.click("#settings-menu > summary");
  await page.click('[data-view="source"]');
  await source.press("X");
  assert.equal(await source.innerText(), "alphXa", "切换标签和预览不能重置光标");
  await source.press("ControlOrMeta+z");
  assert.equal(await source.innerText(), "alpha");
  await source.press("ControlOrMeta+z");
  assert.equal((await source.innerText()).trim(), "", "撤销历史应跨视图和标签保留");
  await page.getByRole("tab").nth(1).click();
  assert.equal(await source.innerText(), "beta", "标签内容不得串用");
  page.once("dialog", d => d.dismiss());
  await page.locator(".tab-close").nth(1).click();
  assert.equal(await page.getByRole("tab").count(), 2);
  await page.close({ runBeforeUnload: false });
});

test("both Diff sources retain edits and undo history through the comparison view", async () => {
  const page = await context.newPage();
  await page.goto(service.origin + "/scratch");
  await page.click("#new-diff");
  const before = page.getByRole("textbox", { name: "Before", exact: true });
  const after = page.getByRole("textbox", { name: "After", exact: true });
  await before.fill("old\nsame");
  await after.fill("new\nsame");
  assert.equal(await page.locator(".cm-lineNumbers").count(), 2);
  await page.click('[data-view="diff"]');
  assert.match(await page.locator("td.content.delete").first().innerText(), /old/);
  assert.match(await page.locator("td.content.insert").first().innerText(), /new/);
  await page.click('[data-view="edit"]');
  assert.equal(await before.innerText(), "old\nsame");
  assert.equal(await after.innerText(), "new\nsame");
  await after.press("ControlOrMeta+z");
  assert.equal((await after.innerText()).trim(), "");
  assert.equal(await before.innerText(), "old\nsame");
  await page.click('[data-view="diff"]');
  assert.equal(await page.locator("td.content.insert").count(), 0);
  assert.match(await page.locator("td.content.delete").first().innerText(), /old/);
  await page.close({ runBeforeUnload: false });
});


test("projects and files dividers drag, persist, keyboard-adjust, reset and clamp the content", async () => {
  const page = await context.newPage();
  await page.goto(service.origin + "/#token=polish");
  await page.locator(".pane-toggle svg").first().waitFor();
  await page.evaluate(() => { for (const key of ["review-projects-width", "review-files-width", "review-reply-width"]) localStorage.removeItem(key); });
  await page.reload();
  await page.locator(".pane-toggle svg").first().waitFor();
  const width = id => page.locator(id).evaluate(el => Math.round(el.getBoundingClientRect().width));
  const projects = await width("#projects-pane");
  const handle = page.locator('.resizer[data-edge="projects"]');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 3, 300); await page.mouse.down();
  await page.mouse.move(box.x + 43, 300); await page.mouse.up();
  assert.ok(await width("#projects-pane") > projects + 30, "projects divider should drag");
  await page.waitForFunction(threshold => Number(localStorage.getItem("review-projects-width")) > threshold, projects + 30);
  const persisted = Number(await page.evaluate(() => localStorage.getItem("review-projects-width")));
  assert.ok(persisted > projects + 30);
  await page.reload();
  await page.locator('.resizer[data-edge="projects"]').waitFor();
  assert.ok(Math.abs(await width("#projects-pane") - persisted) < 2, "projects width should persist");
  const beforeKey = await width("#projects-pane");
  await page.locator('.resizer[data-edge="projects"]').focus();
  await page.keyboard.press("ArrowLeft");
  assert.ok(Math.abs(await width("#projects-pane") - (beforeKey - 20)) < 2, "arrow key should move the divider");
  await page.locator('.resizer[data-edge="files"]').dblclick();
  assert.equal(await width("#projects-pane"), 210);
  assert.equal(await width("#files-pane"), 248);
  assert.equal(await width("#reply-pane"), 470);
  const files = page.locator('.resizer[data-edge="files"]');
  const filesBox = await files.boundingBox();
  await page.mouse.move(filesBox.x + 3, 300); await page.mouse.down();
  await page.mouse.move(1200, 300); await page.mouse.up();
  assert.ok(await width("#content-pane") >= 279, "content must keep its 280px minimum");
  await page.close();
});

test("project location keeps the last two segments and the full path in the title", async () => {
  const root = join(directory, "workspace", "deep", "project-x");
  await mkdir(root, { recursive: true });
  const response = await fetch(service.origin + "/api/projects", { method: "POST", headers: { Authorization: "Bearer polish", "Content-Type": "application/json" }, body: JSON.stringify({ root }) });
  assert.ok(response.ok, await response.text());
  const page = await context.newPage();
  await page.goto(service.origin + "/#token=polish");
  await page.locator(".pane-toggle svg").first().waitFor();
  const project = page.locator(".project", { hasText: "project-x" }).first();
  await project.waitFor();
  assert.equal(await project.getAttribute("title"), await realpath(root));
  assert.equal(await project.locator(".project-path").textContent(), "…/deep/project-x");
  assert.equal(await project.locator(".branch").count(), 0, "no fake branch when Git is unavailable");
  await page.close();
});

test("theme, prose font and default preview sync between the console and the Markdown window", async () => {
  const consolePage = await context.newPage();
  const editorPage = await context.newPage();
  await consolePage.goto(service.origin + "/#token=polish");
  await consolePage.locator(".pane-toggle svg").first().waitFor();
  await editorPage.goto(service.origin + "/scratch");
  await editorPage.locator("#scratch-toolbar").waitFor();
  await consolePage.click("#settings-menu > summary");
  await consolePage.click('[data-setting="theme"] [data-value="light"]');
  await consolePage.click("#settings-menu > summary");
  await editorPage.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  await consolePage.click("#settings-menu > summary");
  await consolePage.click('[data-setting="font"] [data-value="serif"]');
  await consolePage.click("#settings-menu > summary");
  await editorPage.waitForFunction(() => document.documentElement.dataset.font === "serif");
  await consolePage.click("#settings-menu > summary");
  await consolePage.click('label.check:has(#default-preview)');
  await consolePage.click("#settings-menu > summary");
  await editorPage.waitForFunction(() => document.querySelector("#default-preview")?.checked === true);
  assert.equal(await editorPage.evaluate(() => localStorage.getItem("review-theme")), "light");
  await consolePage.close();
  await editorPage.close();
});
