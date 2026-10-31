import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startConsole } from "../../../src/server.ts";
import { key } from "../../../src/store.ts";
import { startSessionInput } from "../../../src/session-input.mjs";

const directory = await mkdtemp(join(tmpdir(), "review-session-performance-"));
const projects = [], sessions = [];
await mkdir(join(directory, "rounds"));
for (let i = 0; i < 20; i++) {
  const path = join(directory, `project-${i}`); await mkdir(path);
  const root = await realpath(path);
  projects.push({ root, name: `project-${i}` });
  const id = `session-${i}`;
  const rounds = Array.from({ length: 1000 }, (_, index) => ({ id: `round-${index}`, end: index, outcome: "completed", count: 0 }));
  sessions.push({ id, root, title: `Session ${i}`, rounds, state: "offline" });
  await writeFile(join(directory, "rounds", key(id + "\0round-999") + ".json"), JSON.stringify({ id: "round-999", sessionId: id, end: 999, outcome: "completed", notice: "Latest round" }));
}
await writeFile(join(directory, "index.json"), JSON.stringify({ projects, sessions }));
const service = await startConsole({ directory, web: resolve("dist/web") });
let idle = true;
const bridge = await startSessionInput({ isIdle: () => idle, send() {} });
const response = await fetch(service.origin + "/api/register", {
  method: "POST", headers: { Authorization: `Bearer ${service.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ cwd: projects[0].root, sessionId: sessions[0].id, title: sessions[0].title, bridge: { origin: bridge.origin, token: bridge.token } }),
});
assert.equal(response.status, 200);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const result = { browser: browser.version(), projects: 20, roundsPerSession: 1000, samples: [], note: "Research only, deferred priority. Isolated Chrome and fake local session bridge, no model or real Agent. Three busy/idle state changes without any new round. State-to-two-animation-frames includes metadata request, DOM update and frame scheduling." };
try {
  await mkdir("test-results/performance", { recursive: true });
  let projectRequests = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/projects") projectRequests++; });
  await page.goto(service.origin + "/#token=" + service.token);
  await page.waitForFunction(() => document.querySelector("#session-state")?.textContent === "Idle" && document.querySelectorAll("#rounds option").length === 1000);
  await page.waitForFunction(() => performance.getEntriesByType("resource").filter(entry => entry.name.includes("/api/git/head?")).length === 20);
  await page.evaluate(() => { window.roundOption = document.querySelector("#rounds option"); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const taskTime = async () => (await cdp.send("Performance.getMetrics")).metrics.find(metric => metric.name === "TaskDuration").value;
  for (let i = 0; i < 3; i++) {
    const before = await taskTime(), beforeRequests = projectRequests;
    const start = await page.evaluate(() => performance.now());
    idle = !idle; bridge.update("");
    await page.waitForFunction(expected => document.querySelector("#session-state")?.textContent === expected, idle ? "Idle" : "Working");
    const sample = await page.evaluate(async start => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { stateToPaintMs: performance.now() - start, preservedRoundOption: roundOption === document.querySelector("#rounds option") };
    }, start);
    sample.taskMs = ((await taskTime()) - before) * 1000;
    sample.metadataRequests = projectRequests - beforeRequests;
    result.samples.push(sample);
  }
  const projectsResponse = await fetch(service.origin + "/api/projects", { headers: { Authorization: `Bearer ${service.token}` } });
  result.metadataBytes = (await projectsResponse.arrayBuffer()).byteLength;
  assert.ok(result.samples.every(sample => sample.preservedRoundOption), "仅忙闲状态变化不应重建未变化的轮次选项");
  assert.ok(result.samples.every(sample => sample.metadataRequests === 0), "已知会话的忙闲状态变化不应重新请求项目/轮次元数据");
  assert.equal(await page.locator("#rounds").inputValue(), "round-999");
  await page.selectOption("#rounds", "round-999");
  await page.screenshot({ path: "test-results/performance/sessions.png" });
} finally {
  await mkdir("test-results/performance", { recursive: true });
  await writeFile("test-results/performance/sessions-before.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
  await bridge.close();
  await service.close();
}
