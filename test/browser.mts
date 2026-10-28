import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startConsole } from "../src/server.ts";
import { diffFile } from "../src/diff.ts";

const directory = await mkdtemp(join(tmpdir(), "review-browser-"));
const root = join(directory, "project-a");
await mkdir(root);
await mkdir("test-results", { recursive: true });
await writeFile(join(root, "README.md"), "# 当前文件\n\n可编辑。\n");
const service = await startConsole({ directory, port: 0, token: "browser-secret", web: resolve("dist/web") });
const headers = { Authorization: "Bearer browser-secret", "Content-Type": "application/json" };
const api = async (path, body, method = body ? "POST" : "GET") => {
  const r = await fetch(service.origin + "/api/" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await r.json();
  assert.ok(r.ok, JSON.stringify(value)); return value;
};
const sessionFile = join(directory, "session.jsonl");
const markdown = "# 本轮完成\n\n看 [README.md](README.md:2)。\n\n$E=mc^2$\n\n```mermaid\nflowchart LR\n  A[审查] --> B[文件]\n```\n\n```plot\n{\"curves\":[{\"fn\":\"x^2\",\"label\":\"平方\"}]}\n```\n\n==重点==\n";
await writeFile(sessionFile, [
  { type: "session", id: "a" },
  { type: "message", id: "old", message: { role: "assistant", content: [{ type: "text", text: "# 上一轮" }] } },
  { type: "message", id: "answer", message: { role: "assistant", content: [{ type: "text", text: markdown }] } },
].map(x => JSON.stringify(x)).join("\n") + "\n");
await api("register", { cwd: root, sessionId: "a", file: sessionFile, title: "项目 A 会话" });
const file = { path: "README.md", status: "Modified", added: 1, deleted: 1, diff: diffFile("README.md", "# 旧标题\n", "# 当前文件\n") };
await api("round", { id: "r0", sessionId: "a", entryId: "old", outcome: "completed", end: 0, notice: "上一轮没有捕获" });
await api("round", { id: "r1", sessionId: "a", entryId: "answer", outcome: "completed", end: 1, report: { id: "r1", cwd: root, start: 0, end: 1, outcome: "completed", prompts: ["修改标题"], files: [file], added: 1, deleted: 1 } });
await api("register", { cwd: root, sessionId: "a2", file: sessionFile, title: "同项目第二会话" });
await api("round", { id: "other-round", sessionId: "a2", outcome: "aborted", end: 0, notice: "第二会话中断" });
for (const name of ["project-b", "project-c"]) { const path = join(directory, name); await mkdir(path); await api("projects", { root: path }); }
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
try {
  await page.goto(service.origin + "/#token=browser-secret&session=a");
  await page.locator("#document h1").waitFor();
  assert.equal(await page.locator("#document h1").textContent(), "本轮完成");
  await page.locator("#document .mermaid-diagram svg").first().waitFor({ timeout: 30000 });
  await page.locator("#document .function-plot-block svg").first().waitFor({ timeout: 30000 });
  assert.ok(await page.locator("#document .katex").count());
  assert.match(await page.locator("#content").textContent(), /旧标题/);
  assert.equal(await page.locator(".project").count(), 3);
  await page.click("#previous");
  await page.waitForFunction(() => document.querySelector("#document h1")?.textContent === "上一轮");
  assert.match(await page.locator("#content").textContent(), /上一轮没有捕获/);
  await api("round", { id: "r2", sessionId: "a", entryId: "answer", outcome: "completed", end: 2, notice: "新轮次" });
  await page.waitForFunction(() => document.querySelectorAll("#rounds option").length === 3);
  assert.equal(await page.locator("#document h1").textContent(), "上一轮");
  await page.click("#latest");
  await page.waitForFunction(() => document.querySelector("#rounds").value === "r2");
  await page.selectOption("#sessions", "a2");
  await page.waitForFunction(() => document.querySelector("#content").textContent.includes("第二会话中断"));
  await page.selectOption("#sessions", "a");
  await page.selectOption("#rounds", "r1");
  await page.waitForFunction(() => document.querySelector("#content").textContent.includes("旧标题"));
  await page.click('[data-collapse="reply-pane"]');
  assert.equal(await page.locator("#reply-pane").evaluate(el => Math.round(el.getBoundingClientRect().width)), 40);
  await page.click('[data-collapse="reply-pane"]');
  await page.screenshot({ path: "test-results/review.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ["same round diff/reply", "math", "Mermaid", "function plot", "3 projects", "session isolation", "paused history", "40px fold"], directory }));
} catch (error) {
  console.error({ errors, document: await page.locator("#document").textContent() });
  await page.screenshot({ path: "test-results/failure.png", fullPage: true });
  throw error;
} finally { await browser.close(); await service.close(); }
