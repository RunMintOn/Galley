import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { startConsole } from "../src/server.ts";
import { diffFile } from "../src/diff.ts";
import { startSessionInput } from "../src/session-input.mjs";

// Deterministic local fixtures only. No model, user repository or pi configuration.
const directory = await mkdtemp(join(tmpdir(), "review-visual-"));
const root = join(directory, "projects", "proj-a-mayoi");
const shots = "test-results/ui";
await mkdir(join(root, "src"), { recursive: true });
await mkdir(join(root, "cmd"));
await mkdir(join(root, "internal"));
await mkdir(shots, { recursive: true });
const before = [
  "package main", "", "func (v *DiffView) draw() {",
  "    y := 0", "    for _, h := range v.hunks {",
  "        if h.collapsed {", "            continue", "        }",
  "        v.drawHunk(h)", "        v.updateScroll()",
  "    }", "}", "", "func (v *DiffView) measure() {",
  "    for _, h := range v.hunks {", "        v.updateScroll()", "    }", "}", "",
].join("\n");
const after = before.replace("            continue", "            v.drawCollapsed(h)\n            continue")
  .replaceAll("        v.updateScroll()", "        v.measure(h)\n        v.updateScroll(h)\n        v.markDirty()");
await writeFile(join(root, "src", "diffview.go"), before);
await writeFile(join(root, "src", "search.go"), "package main\n\nfunc search() {}\n");
await writeFile(join(root, "src", "app.go"), "package main\n\nfunc main() {}\n");
await writeFile(join(root, "src", "editor.go"), "package main\n\nfunc edit() {}\n");
await writeFile(join(root, "README.md"), "# Mayoi\n\n本地项目。\n");
await writeFile(join(root, "go.mod"), "module mayoi\n\ngo 1.23\n");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
git("init", "-b", "main"); git("add", ".");
git("-c", "user.name=Review fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "init: 项目结构");
for (const subject of ["feat(search): 支持正则", "refactor(diff): 拆出 measure 与 updateScroll", "fix(diff): 绘制被折叠的 hunk"]) {
  await writeFile(join(root, "README.md"), "# Mayoi\n\n" + subject + "\n"); git("add", ".");
  git("-c", "user.name=Review fixture", "-c", "user.email=fixture@example.test", "commit", "-m", subject);
}
await writeFile(join(root, "src", "diffview.go"), after);
await writeFile(join(root, "notes.unknown"), "alpha\nbeta\n");
const reply = [
  "# 折叠的 hunk 现在会被画出来", "",
  "之前 collapsed 的分支直接跳过，被折叠掉的那段改动完全不显示，你只能看到「还有 N 行没展开」却没法展开。现在",
  "", "[src/diffview.go](src/diffview.go:5)", "",
  "另外把滚动位置的计算拆成两步，避免每帧重算整张表：", "",
  "```go", "v.hunkTop = make([]int, len(v.hunks)+1)", "v.hunksDirty = false", "```", "",
  "```mermaid", "flowchart LR", ' A["tool call"] --> B["snapshot"] --> C["diff"]', "```", "",
  "## 验证", "", "切换文件不会制造未保存修改；原文仅用于临时预览。", "", "$E=mc^2$",
].join("\n");
const sessionFile = join(directory, "session.jsonl");
await writeFile(sessionFile, [
  { type: "session", id: "visual" },
  { type: "message", id: "earlier", message: { role: "assistant", content: [{ type: "text", text: "# 上一轮\n\n先整理了绘制逻辑。" }] } },
  { type: "message", id: "reply", message: { role: "assistant", content: [{ type: "text", text: reply }] } },
].map(value => JSON.stringify(value)).join("\n") + "\n");
const service = await startConsole({ directory, port: 0, token: "visual-fixture", web: resolve("dist/web") });
const bridge = await startSessionInput({ isIdle: () => true, send() {} });
const api = async (path, body) => {
  const response = await fetch(service.origin + "/api/" + path, { method: "POST", headers: { Authorization: "Bearer visual-fixture", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.ok(response.ok, await response.text());
};
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  await api("register", { cwd: root, sessionId: "visual", file: sessionFile, title: "proj-a-mayoi", bridge: { origin: bridge.origin, token: bridge.token } });
  const files = [
    { path: "src/diffview.go", status: "Modified", added: 7, deleted: 2, diff: diffFile("src/diffview.go", before, after) },
    { path: "src/search.go", status: "Modified", added: 1, deleted: 1, diff: diffFile("src/search.go", "func oldSearch() {}\n", "func search() {}\n") },
    { path: "README.md", status: "Modified", added: 2, deleted: 0, diff: diffFile("README.md", "# Mayoi\n", "# Mayoi\n\n说明。\n") },
    { path: "notes.unknown", status: "Modified", added: 1, deleted: 0, diff: diffFile("notes.unknown", "alpha\n", "alpha\nbeta\n") },
  ];
  for (let i = 0; i < 3; i++) await api("round", { id: "round-" + i, sessionId: "visual", entryId: i ? "reply" : "earlier", end: 1730000000000 + i, outcome: "completed", report: { id: "round-" + i, cwd: root, start: 1730000000000, end: 1730000000000 + i, outcome: "completed", prompts: ["修复折叠的 hunk，保留滚动位置。"], files, added: 11, deleted: 3 } });
  for (const name of ["harness", "ego-site", "dotfiles", "review-console", "notes", "mygo-fork", "ssh-pi-host", "mayoi", "zellij-cfg", "obsidian-vault", "gh-scratch", "project-13", "project-14", "project-15"]) {
    const project = join(directory, "projects", name); await mkdir(project);
    await api("projects", { root: project });
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const typography = target => target.locator("#document").evaluate(node => {
    const style = element => {
      const s = getComputedStyle(element);
      return { font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight, color: s.color, padding: s.padding };
    };
    return { body: style(node), h1: style(node.querySelector("h1")), h2: style(node.querySelector("h2")) };
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(service.origin + "/#token=visual-fixture&session=visual");
  await page.locator("#document .mermaid-diagram svg").first().waitFor();
  await page.locator("#tree summary", { hasText: /^src$/ }).click();
  await page.getByRole("button", { name: "app.go", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const shoot = async name => { await page.mouse.move(1, 899); await page.screenshot({ path: shots + "/" + name + ".png" }); };
  const widths = await page.locator(".pane").evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().width)));
  assert.ok(widths[3] >= 360 && widths.every(width => width > 0), "完整四栏可用且回复栏至少 360px");
  const flush = async (pane, row) => {
    const header = await page.locator(pane + " > header").boundingBox();
    const first = await page.locator(row).first().boundingBox();
    return header && first && Math.abs(header.y + header.height - first.y) <= 1;
  };
  assert.ok(await flush(".projects-pane", "#projects .project[aria-current=true]"), "选中项目行必须贴住栏头");
  assert.ok(await flush(".files-pane", "#changed .file-button[aria-current=true]"), "选中改动行必须贴住栏头");
  assert.equal(await page.locator("#round-time").count(), 0, "轮次时间只在 Round request 里出现");
  assert.equal(await page.locator("#changed-layout").evaluate(el => el.closest("header")?.classList.contains("pane-heading")), true, "Tree/Flat 在 CHANGED 栏头");
  assert.equal(await page.locator(".files-footer .pane-toggle").count(), 1, "files 栏折叠在底栏");
  await page.locator('#changed .file-button[data-path="notes.unknown"]').click();
  await page.waitForFunction(() => document.querySelector("#content-name")?.textContent === "notes.unknown");
  assert.equal(await page.locator(".diff-surface .tk-k").count(), 0, "未知扩展名保持单色");
  await page.locator('#changed .file-button[data-path="src/diffview.go"]').click();
  await page.waitForFunction(() => document.querySelector("#content-name")?.textContent === "src/diffview.go");
  assert.ok(await page.locator(".diff-surface .tk-k").count() > 0, "Go diff 必须有 token 颜色");
  await page.locator("#project-menu > summary").click();
  assert.equal(await page.getByRole("button", { name: "Remove current project", exact: true }).isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "Remove current project", exact: true }).isVisible(), false);
  await shoot("01-review");
  await page.locator('.content-pane .pane-toggle').click();
  assert.ok(await page.locator("#reply-pane").evaluate(node => node.getBoundingClientRect().width > 900));
  assert.ok(await page.locator("#files-pane").evaluate(node => node.getBoundingClientRect().width > 200), "收起内容栏保留文件栏");
  assert.equal(await page.locator('.content-pane .rail-button').getAttribute("aria-expanded"), "false");
  await shoot("02-reply-focus");
  await page.locator('.content-pane .rail-button').click();
  await page.locator('.reply-pane .pane-toggle').click();
  await page.waitForFunction(() => !document.querySelector('[data-layout="split"]').disabled);
  await shoot("03-diff-focus");
  await page.locator('[data-layout="split"]').click();
  await shoot("03b-split");
  await page.click("#history-tab");
  await page.locator(".commit-row").first().waitFor();
  await shoot("04-history");
  await page.locator('.reply-pane .rail-button').click();
  await page.click("#show-source");
  assert.equal(await page.locator("#show-source").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#content-name").textContent(), "Reply source");
  assert.equal(await page.locator("#source-toolbar").isVisible(), true);
  assert.equal(await page.locator("#doc-toolbar").isVisible(), false);
  assert.equal(await page.locator("#content-pane > footer").isVisible(), false);
  await page.fill("#reply-source", "# 临时预览\n\n" + reply);
  await page.waitForFunction(() => document.querySelector("#document h1")?.textContent === "临时预览");
  await shoot("05-source");
  await page.click("#show-source");
  assert.equal(await page.locator("#show-source").getAttribute("aria-pressed"), "false");
  await page.locator(".commit-row").first().waitFor();
  await page.selectOption("#rounds", "round-1");
  await page.waitForFunction(() => document.querySelector("#content-name").textContent === "src/diffview.go");
  await page.locator("#tree .file-button", { hasText: "app.go" }).click();
  await page.locator(".cm-content").waitFor();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.inputValue("#rounds"), "round-1", "在只读文件中移动光标不能误切换轮次");
  await shoot("06-file");
  await page.locator('.content-pane .pane-toggle').click();
  await page.click("#show-source");
  assert.equal(await page.locator("#source-view").isVisible(), true);
  assert.ok(await page.locator("#content-pane").evaluate(node => node.getBoundingClientRect().width > 260));
  await page.click("#close-source");
  await page.locator(".cm-content").waitFor();
  await page.click("#turn-tab");
  await page.selectOption("#rounds", "round-2");
  await page.click("#show-source");
  await page.click("#previous");
  await page.waitForFunction(() => document.querySelector("#reply-source").value.includes("折叠的 hunk"));
  assert.equal(await page.inputValue("#reply-source"), reply);
  await page.click("#previous");
  await page.waitForFunction(() => document.querySelector("#document h1")?.textContent === "上一轮");
  assert.match(await page.inputValue("#reply-source"), /上一轮/);
  assert.equal(await page.locator("#document h1").textContent(), "上一轮");
  await page.click("#next");
  await page.waitForFunction(() => document.querySelector("#document h1")?.textContent === "折叠的 hunk 现在会被画出来");
  await page.click("#next");
  await page.waitForFunction(() => document.querySelector("#rounds").value === "round-2" && document.querySelector("#reply-source").value.includes("折叠的 hunk"));
  await page.click("#show-source");
  await page.locator("#document .mermaid-diagram svg").first().waitFor();
  await page.locator("#reply-pane").screenshot({ path: shots + "/07-reply-pane.png" });
  const replyTypography = await typography(page);
  await page.click("#toggle-input");
  await page.locator("#message-input").fill("继续讨论这个改动");
  await shoot("08-input");
  await page.click("#toggle-input");
  await page.click("#settings-menu > summary");
  await page.click('[data-setting="theme"] [data-value="light"]');
  await page.click("#settings-menu > summary");
  await shoot("09-light");
  await page.click("#settings-menu > summary");
  await page.click('[data-setting="theme"] [data-value="dark"]');
  await page.click("#settings-menu > summary");
  await page.setViewportSize({ width: 1050, height: 900 });
  const toolbarOverflows = await page.locator(".reply-header").evaluate(node => node.scrollWidth > node.clientWidth);
  assert.equal(toolbarOverflows, false, "窄栏工具条不能溢出");
  await shoot("10-narrow");
  await page.locator("#project-menu > summary").click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Remove current project", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".project").length === 14);
  // Wait one debounce interval before an external write, so the initial tree
  // load cannot masquerade as a working watch on the newly selected project.
  await page.waitForTimeout(400);
  await writeFile(join(directory, "projects", "harness", "new-file.md"), "# 新文件\n");
  await page.getByRole("button", { name: "new-file.md", exact: true }).waitFor({ timeout: 3000 });
  // Optional old-plugin reference is explicitly opt-in; routine verification stays isolated.
  let original, originalTypography;
  try {
    if (process.env.REVIEW_COMPARE_LEGACY !== "1") throw new Error("legacy reference not requested");
    const state = JSON.parse(await readFile(join(homedir(), ".pi", "agent", "pi-pele-preview", "service.json"), "utf8"));
    const reference = await browser.newPage({ viewport: { width: 528, height: 900 } });
    await reference.goto(state.origin);
    await reference.locator("#source").waitFor();
    await reference.waitForFunction(() => !document.body.classList.contains("booting") && document.querySelector("#document h1"));
    await reference.locator("#source").fill(reply);
    await reference.locator("#render").click();
    await reference.waitForFunction(() => document.querySelector("#document h1")?.textContent === "折叠的 hunk 现在会被画出来");
    if (await reference.locator("#toggle-editor").getAttribute("aria-expanded") === "true") await reference.locator("#toggle-editor").click();
    await reference.locator("#document .mermaid-diagram svg").first().waitFor();
    await reference.locator("#theme").evaluate(button => {
      if (!document.documentElement.classList.contains("dark")) button.click();
    });
    await reference.locator("#document .mermaid-diagram svg").first().waitFor();
    originalTypography = await typography(reference);
    await reference.screenshot({ path: shots + "/00-original-visual-reply.png" });
    original = { origin: state.origin, directory: state.directory };
  } catch (error) {
    original = { unavailable: String(error) };
  }
  // Typography is visually reviewed against the new prototype, not the old plugin palette.
  assert.deepEqual(errors, []);
  await writeFile(shots + "/result.json", JSON.stringify({ original, replyTypography, originalTypography, viewport: [1440, 900], widths, errors, directory, noModelCalls: true }, null, 2));
  console.log(JSON.stringify({ visualFlowsPassed: true, original, screenshots: shots, directory }));
} finally { await browser.close(); await bridge.close(); await service.close(); }
