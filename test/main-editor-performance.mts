import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startConsole } from "../src/server.ts";

const directory = await mkdtemp(join(tmpdir(), "review-main-editor-"));
const root = join(directory, "project"); await mkdir(root);
const files = [1000, 42000].map(lines => ({
  path: `code-${lines}.ts`,
  content: Array.from({ length: lines }, (_, i) => `export const item_${i} = compute(${i});\n`).join(""),
}));
for (const file of files) {
  assert.ok(Buffer.byteLength(file.content) < 2 * 1024 * 1024);
  await writeFile(join(root, file.path), file.content);
}
const require = createRequire(import.meta.url);
const reference = process.argv.find(arg => arg.startsWith("--ref="))?.slice(6);
const sourcePlugins = reference ? [{
  name: "reference-editor-source",
  setup(build) {
    build.onLoad({ filter: /[/\\]web-src[/\\](editor|diff)\.js$/ }, args => ({
      contents: execFileSync("git", ["show", `${reference}:web-src/${args.path.endsWith("editor.js") ? "editor.js" : "diff.js"}`], { encoding: "utf8" }),
      resolveDir: resolve("web-src"),
    }));
  },
}] : [];
const [appBundle, diffBundle] = await Promise.all([
  build({
    stdin: {
      resolveDir: process.cwd(), sourcefile: "main-editor-fixture.js",
      contents: `import { EditorState } from "@codemirror/state";
        import { EditorView } from "@codemirror/view";
        import { syntaxTreeAvailable } from "@codemirror/language";
        import "./web-src/app.js";
        const slice = EditorState.prototype.sliceDoc;
        window.fullReads = {calls:0, characters:0};
        EditorState.prototype.sliceDoc = function(from=0, to=this.doc.length) {
          if(from===0 && to===this.doc.length) { fullReads.calls++; fullReads.characters += this.doc.length; }
          return slice.call(this, from, to);
        };
        window.fileView = () => EditorView.findFromDOM(document.querySelector("#content .cm-content"));
        window.syntaxReady = () => syntaxTreeAvailable(fileView().state, fileView().state.doc.length);
        window.moveToEnd = () => { const view=fileView(); view.dispatch({selection:{anchor:view.state.doc.length},effects:EditorView.scrollIntoView(view.state.doc.length)}); view.focus(); };
        window.typeProbe = async () => {
          const view=fileView(), at=view.state.selection.main.head;
          window.fullReads={calls:0,characters:0};
          const start=performance.now();
          view.dispatch({changes:{from:at,insert:"x"},selection:{anchor:at+1},userEvent:"input.type"});
          const dispatchMs=performance.now()-start, reads={...fullReads};
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          return {dispatchMs,paintOpportunityMs:performance.now()-start,...reads};
        };`,
    },
    plugins: sourcePlugins,
    bundle: true, write: false, format: "esm", target: "es2022", minify: true,
  }),
  build({
    stdin: {
      resolveDir: process.cwd(), sourcefile: "diff-performance-fixture.js",
      contents: `import { mountDiff } from "./web-src/diff.js";
        window.showDiff = async file => {
          window.diffView?.destroy();
          const root=document.querySelector("#diff-root"); root.replaceChildren();
          localStorage.setItem("review-diff-layout","unified");
          window.wordDiffCalls=0;
          const start=performance.now();
          window.diffView=mountDiff(root,file,undefined,{toolbar:document.querySelector("#diff-toolbar")});
          const renderMs=performance.now()-start, wordDiffCalls=window.wordDiffCalls;
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          return {renderMs,paintOpportunityMs:performance.now()-start,wordDiffCalls};
        };
        window.changeLayout = async layout => {
          window.wordDiffCalls=0;
          const start=performance.now();
          diffView.controls.querySelector('[data-layout="'+layout+'"]').click();
          const renderMs=performance.now()-start, wordDiffCalls=window.wordDiffCalls;
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          return {renderMs,paintOpportunityMs:performance.now()-start,wordDiffCalls};
        };`,
    },
    plugins: [...sourcePlugins, {
      name: "measure-word-diff",
      setup(build) {
        build.onResolve({ filter: /^diff$/ }, () => ({ path: "measured-diff", namespace: "perf" }));
        build.onLoad({ filter: /.*/, namespace: "perf" }, () => ({
          contents: `import { diffWordsWithSpace as original } from ${JSON.stringify(require.resolve("diff"))}; export function diffWordsWithSpace(...args) { window.wordDiffCalls++; return original(...args); }`,
          resolveDir: process.cwd(),
        }));
      },
    }],
    bundle: true, write: false, format: "esm", target: "es2022", minify: true,
  }),
]);
const service = await startConsole({ directory: join(directory, "state"), web: resolve("dist/web") });
await fetch(service.origin + "/api/projects", {
  method: "POST", headers: { Authorization: `Bearer ${service.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ root }),
});
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on("pageerror", error => errors.push(error.message));
const result = { browser: browser.version(), source: reference || "working tree", editor: [], diffs: [], note: "Main window only, no pi sessions or scratch window. App bundled with diagnostic counters around CodeMirror sliceDoc; inputs dispatch real CodeMirror transactions. Three cold input samples after jumping to EOF, then three warm samples after syntaxTreeAvailable. openMs includes Playwright waits, not a product latency budget. Diff uses the production component and library with a transparent word-diff call counter. Synthetic local fixtures, not production percentiles or WKWebView timings." };
const label = process.argv.includes("--baseline") ? "before" : "after";
try {
  await mkdir("test-results/performance", { recursive: true });
  await page.route("**/app.js", route => route.fulfill({ contentType: "text/javascript", body: appBundle.outputFiles[0].text }));
  await page.goto(service.origin + "/#token=" + service.token);
  for (const file of files) {
    const start = performance.now();
    await page.locator(`#tree [data-path="${file.path}"]`).click();
    await page.getByRole("button", { name: "Edit (e)", exact: true }).click();
    await page.locator('#content .cm-content[contenteditable="true"]').waitFor();
    const openMs = performance.now() - start;
    await page.evaluate(() => moveToEnd());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const edits = [];
    for (let i = 0; i < 3; i++) edits.push(await page.evaluate(() => typeProbe()));
    if (process.argv.includes("--profile") && file.content.length > 1024 * 1024) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Profiler.enable"); await cdp.send("Profiler.start");
      for (let i = 0; i < 20; i++) await page.evaluate(() => typeProbe());
      const { profile } = await cdp.send("Profiler.stop");
      await writeFile("test-results/performance/main-editor.cpuprofile", JSON.stringify(profile));
    }
    await page.waitForFunction(() => syntaxReady(), undefined, { timeout: 30000 });
    const warmEdits = [];
    for (let i = 0; i < 3; i++) warmEdits.push(await page.evaluate(() => typeProbe()));
    result.editor.push({ bytes: Buffer.byteLength(file.content), openMs, edits, warmEdits });
    const save = page.getByRole("button", { name: "Save ⌘S", exact: true });
    for (let i = 0; i < 3 && !await save.isDisabled(); i++) await page.keyboard.press("ControlOrMeta+z");
    assert.ok(await save.isDisabled(), "完全撤销后必须回到已保存状态");
    await page.evaluate(() => {
      const view=fileView();
      view.dispatch({changes:{from:0,to:1,insert:"E"}});
    });
    assert.ok(!await save.isDisabled(), "等长修改必须标记为未保存");
    await page.evaluate(() => fileView().dispatch({changes:{from:0,to:1,insert:"e"}}));
    assert.ok(await save.isDisabled(), "手动恢复原内容也必须回到已保存状态");
  }
  await page.route("**/diff-performance", route => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html class="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><main class="pane content-pane" style="width:1200px;height:850px"><div id="diff-toolbar" class="doc-toolbar"></div><div id="diff-root" class="diff-surface" style="overflow:auto"></div></main><script type="module" src="/diff-fixture.js"></script></body></html>',
  }));
  await page.route("**/diff-fixture.js", route => route.fulfill({ contentType: "text/javascript", body: diffBundle.outputFiles[0].text }));
  await page.goto(service.origin + "/diff-performance");
  await page.waitForFunction(() => window.showDiff);
  const cases = [250, 1000].map(count => ({
    name: `${count} changed lines`,
    before: Array.from({ length: count }, (_, i) => `export const item_${i} = calculate(${i}, "old");`),
    after: Array.from({ length: count }, (_, i) => `export const item_${i} = calculate(${i}, "new");`),
  }));
  for (const count of [1000, 4000]) {
    const longLine = "const records = [" + Array.from({ length: count }, (_, i) => `{ id: ${i}, value: "entry-${i}" }`).join(", ") + "];";
    cases.push({ name: `long highlighted line (${count} records)`, before: [longLine], after: [longLine.replace("entry-500", "replacement-500")] });
  }
  for (const sample of cases) {
    const count = sample.before.length;
    const file = { path: "example.ts", status: "Modified", added: count, deleted: count, diff: {
      blocks: [{ oldStartLine: 1, oldLineCount: count, newStartLine: 1, newLineCount: count, lines: [
        ...sample.before.map((content, i) => ({ type: "delete", oldNumber: i + 1, content })),
        ...sample.after.map((content, i) => ({ type: "insert", newNumber: i + 1, content })),
      ] }],
    } };
    const initial = await page.evaluate(file => showDiff(file), file);
    const split = await page.evaluate(() => changeLayout("split"));
    assert.equal(await page.locator("tr.change").count(), count);
    const unified = await page.evaluate(() => changeLayout("unified"));
    assert.equal(await page.locator("tr.delete").count(), count);
    assert.equal(await page.locator("tr.insert").count(), count);
    assert.ok(await page.locator("td.content .tk-k").count(), "保留关键字语法色");
    assert.ok(await page.locator("td.content .tk-s .hl-d").count(), "字符串语法色与词级删除标记必须正确嵌套");
    assert.ok(await page.locator("td.content .tk-s .hl-i").count(), "字符串语法色与词级新增标记必须正确嵌套");
    assert.equal(await page.locator("tr.delete td.content").last().textContent(), sample.before.at(-1));
    assert.equal(await page.locator("tr.insert td.content").last().textContent(), sample.after.at(-1));
    result.diffs.push({ name: sample.name, bytes: Buffer.byteLength(sample.before.join("\n")), initial, split, unified });
  }
  await page.screenshot({ path: "test-results/performance/main-diff.png" });
  assert.deepEqual(errors, []);
  assert.ok(result.editor.every(file => [...file.edits, ...file.warmEdits].every(edit => edit.calls === 0)), "主编辑器输入不应为了判断未保存状态反复序列化全文");
  assert.ok(result.diffs.every(file => file.split.wordDiffCalls === 0 && file.unified.wordDiffCalls === 0), "Diff 布局切换不应重新执行未变化内容的词级比较");
} finally {
  await writeFile(`test-results/performance/main-editor-${label}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
  await service.close();
}
