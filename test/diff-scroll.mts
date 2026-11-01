// Actual Git workspace UI and scroll sampling, isolated repository, no Agent.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { startConsole } from "../src/server.ts";

const directory = await mkdtemp(join(tmpdir(), "galley-scroll-")), root = join(directory, "repo");
await mkdir(root);
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
git("init", "-b", "main");
const count = 2500;
const source = value => Array.from({ length: count }, (_, i) =>
  `export const item_${i} = calculate(${i}, "${value}", { enabled: true, label: "record-${i}" });`).join("\n") + "\n";
await writeFile(join(root, "long.ts"), source("old"));
git("add", "."); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Initial");
await writeFile(join(root, "long.ts"), source("new"));
const service = await startConsole({ directory: join(directory, "state"), web: resolve("dist/web") });
const reference = process.argv.find(arg => arg.startsWith("--ref="))?.slice(6);
const referenceCSS = reference ? execFileSync("git", ["show", `${reference}:web-src/style.css`], { encoding: "utf8" }) : "";
await fetch(service.origin + "/api/projects", {
  method: "POST", headers: { Authorization: `Bearer ${service.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ root }),
});
if (process.argv.includes("--native")) {
  try {
    const { sampleNative } = await import("./diff-scroll-native.mts");
    await sampleNative(directory, referenceCSS, reference);
  } finally { await service.close(); }
} else {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  const requests = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/git/")) requests.push(new URL(request.url()).pathname); });
  const result = { browser: browser.version(), sourceCSS: reference || "working tree", directory, rows: count * 2, samples: [] };
  const label = process.argv.includes("--baseline") ? "before" : "after";
  try {
    await mkdir("test-results/performance", { recursive: true });
    await page.goto(service.origin + "/#token=" + service.token);
    if (referenceCSS) await page.addStyleTag({ content: referenceCSS });
    await page.click("#history-tab");
    await page.locator(".commit-card").waitFor();
    await page.locator('.workspace-file[data-path="long.ts"]').click();
    await page.waitForFunction(expected => document.querySelectorAll("#content table.diff tr").length === expected, count * 2);
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
    result.tokens = await page.locator("#content .diff .tk-k, #content .diff .tk-f, #content .diff .tk-n, #content .diff .tk-s").evaluateAll(tokens => ({
      count: tokens.length,
      translucent: tokens.filter(token => Number(getComputedStyle(token).opacity) < 1).length,
      colored: tokens.filter(token => getComputedStyle(token).color !== getComputedStyle(token.closest("td")).color).length,
    }));
    await cdp.send("Performance.enable");
    const rect = await page.locator("#content").boundingBox();
    for (let run = 0; run < 2; run++) {
      requests.length = 0;
      const before = (await cdp.send("Performance.getMetrics")).metrics;
      await page.evaluate(() => {
        window.scrollProbe = { frames: [], added: 0, removed: 0, textChanges: 0, positions: [] };
        const probe = scrollProbe, content = document.querySelector("#content");
        probe.original = content.querySelector("td.content");
        probe.observer = new MutationObserver(records => {
          for (const record of records) {
            probe.added += record.addedNodes.length; probe.removed += record.removedNodes.length;
            if (record.type === "characterData") probe.textChanges++;
          }
        });
        probe.observer.observe(content, { subtree: true, childList: true, characterData: true });
        let previous;
        const tick = now => {
          if (previous) probe.frames.push(now - previous);
          previous = now; probe.positions.push(content.scrollTop);
          probe.raf = requestAnimationFrame(tick);
        };
        probe.raf = requestAnimationFrame(tick);
      });
      for (const direction of [-1, 1]) await cdp.send("Input.synthesizeScrollGesture", {
        x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
        yDistance: direction * 6000, speed: 3000, gestureSourceType: "mouse",
      });
      const sample = await page.evaluate(() => {
        const probe = scrollProbe; cancelAnimationFrame(probe.raf); probe.observer.disconnect();
        const frames = probe.frames.sort((a, b) => a - b), scroller = document.querySelector("#content");
        return {
          added: probe.added, removed: probe.removed, textChanges: probe.textChanges,
          preservedFirstCell: probe.original === scroller.querySelector("td.content"),
          start: probe.positions[0], end: scroller.scrollTop, maxScroll: Math.max(...probe.positions),
          frameCount: frames.length, p50: frames[Math.floor(frames.length * .5)], p95: frames[Math.floor(frames.length * .95)], maxFrame: frames.at(-1),
          viewport: scroller.clientHeight, contentHeight: scroller.scrollHeight,
        };
      });
      const after = (await cdp.send("Performance.getMetrics")).metrics;
      sample.work = Object.fromEntries(["LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"].map(name => [
        name, after.find(m => m.name === name).value - before.find(m => m.name === name).value,
      ]));
      sample.gitRequests = [...requests];
      result.samples.push(sample);
    }
    await page.screenshot({ path: "test-results/performance/diff-scroll.png" });
    assert.deepEqual(errors, []);
    assert.ok(result.tokens.count > 10000 && result.tokens.colored === result.tokens.count, "保留完整的词级语法高亮");
    assert.equal(result.tokens.translucent, 0, "不能为每个高亮 token 创建透明度叠加分组；该方式会使 WKWebView 长 Diff 滚动退化");
    for (const sample of result.samples) {
      assert.equal(sample.added + sample.removed + sample.textChanges, 0, "往返滚动不得重建 Diff 内容");
      assert.equal(sample.preservedFirstCell, true);
      assert.equal(sample.gitRequests.length, 0, "滚动不得重新请求未变化的 Git Diff");
      assert.ok(sample.maxScroll >= 5900 && sample.end < 10, "必须实际滚离顶部再返回");
    }
  } finally {
    await writeFile(`test-results/performance/diff-scroll-${label}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    await browser.close(); await service.close();
  }
}
