import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startConsole } from "../src/server.ts";

const directory = await mkdtemp(join(tmpdir(), "review-performance-"));
const service = await startConsole({ directory, web: resolve("dist/web") });
const bundle = await build({
  stdin: {
    contents: 'import { createReplyRenderer } from "./web-src/reply.js"; window.previewRenderer = createReplyRenderer(document.querySelector("article"), { resolveImage: async source => { window.imageReads++; return "data:image/svg+xml," + encodeURIComponent("<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"1\\" height=\\"1\\"/>"); } }); window.imageReads = 0;',
    resolveDir: process.cwd(), sourcefile: "performance-fixture.js",
  },
  bundle: true, write: false, format: "esm", target: "es2022", minify: true,
});
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const results = { browser: browser.version(), samples: [], checks: {}, note: "Isolated Chrome, current source. Render-to-two-animation-frames includes layout, excludes editor debounce. Three prose edits per size; synthetic code-heavy Markdown, not a production percentile or WKWebView measurement." };
const label = process.argv.includes("--baseline") ? "baseline" : "after";
try {
  await mkdir("test-results/performance", { recursive: true });
  const root = join(directory, "repo"); await mkdir(root);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git("init", "-b", "main");
  await writeFile(join(root, "tracked.txt"), "original\n"); git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "initial");
  await writeFile(join(root, "tracked.txt"), "staged\n"); git("add", ".");
  for (let i = 0; i < 120; i++) await writeFile(join(root, `other-${i}.txt`), "other content\n".repeat(10000));
  const headers = { Authorization: `Bearer ${service.token}`, "Content-Type": "application/json" };
  await fetch(service.origin + "/api/projects", { method: "POST", headers, body: JSON.stringify({ root }) });
  results.workspaceFileMs = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    const response = await fetch(service.origin + "/api/git/workspace-file?" + new URLSearchParams({ root, group: "staged", path: "tracked.txt" }), { headers });
    const file = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual([file.added, file.deleted], [1, 1]);
    results.workspaceFileMs.push(performance.now() - start);
  }
  results.workspaceFixture = "One staged file plus 120 unrelated untracked files, each 10,000 lines.";
  await page.route("**/performance-fixture", route => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html class="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><main class="reply-pane" style="width:720px"><article class="markdown-body"></article></main><script type="module" src="/performance-fixture.js"></script></body></html>',
  }));
  await page.route("**/performance-fixture.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto(service.origin + "/performance-fixture");
  await page.waitForFunction(() => window.previewRenderer);
  const block = "## Section\n\n这是一段日常审阅的 Markdown，包含 **重要内容** 和 `inlineCode`。\n\n```js\nfunction compute(value) {\n  return value * 2;\n}\n```\n\n";
  for (const count of [40, 400, 1600]) {
    const text = "# Performance\n\nintro\n\n" + block.repeat(count);
    await page.evaluate(text => window.previewRenderer.render(text), text);
    const edits = [];
    for (let i = 0; i < 3; i++) {
      edits.push(await page.evaluate(async text => {
        const article = document.querySelector("article");
        let removedElements = 0;
        const observer = new MutationObserver(records => {
          for (const record of records) for (const node of record.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && !node.matches(".docmeta") && !node.closest?.(".docmeta")) removedElements++;
          }
        });
        observer.observe(article, { childList: true });
        const start = performance.now();
        window.previewRenderer.render(text);
        const renderMs = performance.now() - start;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        observer.disconnect();
        return { renderMs, paintOpportunityMs: performance.now() - start, removedElements };
      }, text.replace("intro", "intro" + "x".repeat(i + 1))));
    }
    results.samples.push({ bytes: Buffer.byteLength(text), codeBlocks: count, edits });
  }
  for (const sample of results.samples) for (const edit of sample.edits) {
    assert.equal(edit.removedElements, 1, "单段正文编辑不应移除其他顶层内容");
  }

  const markdown = "# Review\n\nA paragraph.\n\n- first\n- second\n\n```js\nconst value = 1;\n```\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n```plot\n{\"curves\":[{\"fn\":\"x^2\",\"label\":\"square\"}]}\n```\n\n![local](local.svg)\n\n[reference][target]\n\nA footnote[^note].\n\n[target]: https://example.test/one\n[^note]: note one\n";
  await page.evaluate(text => window.previewRenderer.render(text), markdown);
  await page.locator(".mermaid-diagram svg.pele").waitFor();
  await page.locator(".function-plot-block svg").waitFor();
  await page.waitForFunction(() => document.querySelector("article img")?.complete);
  await page.evaluate(() => {
    window.kept = {
      code: document.querySelector(".code-block"),
      diagram: document.querySelector(".mermaid-diagram svg.pele"),
      plot: document.querySelector(".function-plot-block svg"),
      image: document.querySelector("article img"),
      imageReads: window.imageReads,
    };
  });
  await page.evaluate(text => window.previewRenderer.render(text.replace("A paragraph.", "An edited paragraph.")), markdown);
  await page.locator(".mermaid-diagram svg.pele").waitFor();
  results.checks.reuse = await page.evaluate(() => ({
    code: kept.code === document.querySelector(".code-block"),
    diagram: kept.diagram === document.querySelector(".mermaid-diagram svg.pele"),
    plot: kept.plot === document.querySelector(".function-plot-block svg"),
    image: kept.image === document.querySelector("article img"),
    imageReads: window.imageReads - kept.imageReads,
  }));
  assert.deepEqual(results.checks.reuse, { code: true, diagram: true, plot: true, image: true, imageReads: 0 }, "编辑正文不应重建未变化的代码、图表或图片");

  await page.evaluate(text => window.previewRenderer.render(text.replace("example.test/one", "example.test/two").replace("note one", "note two")), markdown);
  assert.equal(await page.getByRole("link", { name: "reference", exact: true }).getAttribute("href"), "https://example.test/two");
  assert.match(await page.locator(".footnotes").innerText(), /note two/);
  assert.equal(await page.locator("article ul:not(.plot-legend) > li").count(), 2);
  await page.evaluate(text => window.previewRenderer.render(text.replace("A --> B", "A --> Changed")), markdown);
  await page.waitForFunction(() => document.querySelector(".mermaid-diagram svg.pele")?.textContent.includes("Changed"));
  const twoDiagrams = "```mermaid\nflowchart LR\n A --> B\n```\n\nmiddle\n\n```mermaid\nflowchart LR\n C --> D\n```\n";
  await page.evaluate(text => window.previewRenderer.render(text), twoDiagrams);
  await page.waitForFunction(() => document.querySelectorAll(".mermaid-diagram svg.pele").length === 2);
  await page.evaluate(() => { window.lastDiagram = [...document.querySelectorAll(".mermaid-diagram svg.pele")].at(-1); });
  await page.evaluate(text => window.previewRenderer.render("prefix\n\n" + text.replace("A --> B", "A --> Changed")), twoDiagrams);
  await page.waitForFunction(() => document.querySelector(".mermaid-diagram svg.pele")?.textContent.includes("Changed"));
  assert.ok(await page.evaluate(() => lastDiagram === [...document.querySelectorAll(".mermaid-diagram svg.pele")].at(-1)), "前方插入块和修改图表不应重建后方图表");
  await page.evaluate(text => { document.documentElement.classList.remove("dark"); window.previewRenderer.render(text); }, twoDiagrams);
  await page.waitForFunction(() => document.querySelectorAll(".mermaid-diagram svg.pele").length === 2);
  assert.ok(await page.evaluate(() => lastDiagram !== [...document.querySelectorAll(".mermaid-diagram svg.pele")].at(-1)), "主题变化需要刷新图表");
  await page.screenshot({ path: "test-results/performance/render.png" });
  await page.evaluate(() => window.previewRenderer.render("# New\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n$E=mc^2$\n\n`src/main.ts`\n\n```mermaid\nnot a valid diagram\n```\n"));
  await page.locator(".diagram-error").waitFor();
  assert.equal(await page.locator("article table tr").count(), 2);
  assert.ok(await page.locator(".katex").count());
  assert.equal(await page.locator('a[href="src/main.ts"]').innerText(), "src/main.ts");
  assert.equal(await page.locator("article").getAttribute("data-state"), "failed");
  await page.evaluate(() => window.previewRenderer.render(""));
  assert.equal(await page.locator("article").innerHTML(), "");
  await page.evaluate(() => { window.previewRenderer.destroy(); window.previewRenderer.render("# Reused\n\nworks"); });
  assert.equal(await page.locator("article h1").innerText(), "Reused", "审查台复用已清空的渲染器");
  assert.deepEqual(errors, []);
} finally {
  await mkdir("test-results/performance", { recursive: true });
  await writeFile(`test-results/performance/${label}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  await browser.close();
  await service.close();
}
