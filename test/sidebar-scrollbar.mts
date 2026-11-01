import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { before, test } from "node:test";
import { chromium } from "playwright";

before(() => mkdir("test-results/sidebar", { recursive: true }));

test("project text stays 16px from the left edge regardless of working state", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.setContent(`<nav id="projects" style="width:180px">
      <button class="project"><span class="project-dot"></span><span class="project-name">Project</span><span class="project-meta"><span class="branch">main</span><span class="project-count">7</span></span><span class="project-path">…/projects/example</span></button>
      <button class="project"><span class="project-dot working"></span><span class="project-name">Other</span><span class="project-path">…/projects/other</span></button>
    </nav>`);
    await page.addStyleTag({ content: await readFile(new URL("../web-src/style.css", import.meta.url), "utf8") });
    const positions = () => page.locator(".project-name, .project-path, .project .branch").evaluateAll(elements =>
      elements.map(el => el.getBoundingClientRect().left - el.closest(".project").getBoundingClientRect().left));
    assert.deepEqual(await positions(), [16, 16, 16, 16, 16]);
    await page.locator(".project-dot").evaluateAll(dots => dots.forEach(dot => dot.classList.toggle("working")));
    assert.deepEqual(await positions(), [16, 16, 16, 16, 16], "圆点状态变化不移动文字");
    assert.equal(await page.locator(".project").first().evaluate(el =>
      el.querySelector(".project-name").getBoundingClientRect().left -
      el.querySelector(".project-dot").getBoundingClientRect().right), 6, "圆点与文字保留6px间距");
    assert.equal(await page.locator(".project-count").evaluate(el => {
      const name = el.closest(".project").querySelector(".project-name").getBoundingClientRect();
      return el.getBoundingClientRect().left >= name.right;
    }), true, "项目数量保留在名称右侧");
  } finally {
    await browser.close();
  }
});

test("project toolbar icons share the same vertical center", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent(await readFile(new URL("../web-src/index.html", import.meta.url), "utf8"));
    await page.addStyleTag({ content: await readFile(new URL("../web-src/style.css", import.meta.url), "utf8") });
    await page.evaluate(() => {
      document.body.classList.remove("booting");
      document.documentElement.classList.add("desktop");
      document.documentElement.style.setProperty("--mygo-titlebar-inset-left", "64px");
      document.querySelector(".projects-pane .pane-toggle").innerHTML =
        '<svg class="icon"><use href="#i-panel-left"/></svg>';
    });
    const centers = await page.locator(".projects-pane > header .icon").evaluateAll(icons =>
      icons.map(icon => { const box = icon.getBoundingClientRect(); return box.y + box.height / 2; }));
    assert.equal(centers.length, 2, "顶部只保留加号和收起图标");
    assert.ok(Math.max(...centers) - Math.min(...centers) < 0.5, `按钮中心坐标：${centers}`);
    await page.locator(".projects-pane > header").screenshot({ path: "test-results/sidebar/project-toolbar.png" });
  } finally {
    await browser.close();
  }
});

test("sidebar scrollbar overlays full-width selection, hides when idle, and supports dragging", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`<section class="pane files-pane" style="width:248px;height:400px">
      <header>GIT</header><div class="pane-body" id="git-index">${Array.from({ length: 30 }, (_, i) =>
        `<button class="commit-row" aria-current="${i === 4}">Commit ${i}</button>`).join("")}</div></section>`);
    await page.addStyleTag({ content: await readFile(new URL("../web-src/style.css", import.meta.url), "utf8") });
    await page.addScriptTag({ type: "module", content:
      await readFile(new URL("../web-src/overlay-scrollbar.js", import.meta.url), "utf8") +
      '\nsetupOverlayScrollbars(document.querySelectorAll(".pane > .pane-body"));' });
    const bar = page.locator(".overlay-scrollbar");
    assert.equal(await bar.evaluate(el => getComputedStyle(el).opacity), "0");
    const gap = () => page.evaluate(() =>
      document.getElementById("git-index").getBoundingClientRect().right -
      document.querySelector(".commit-row").getBoundingClientRect().right);
    assert.equal(await gap(), 0);
    await page.locator("#git-index").hover();
    await page.mouse.wheel(0, 180);
    await page.waitForFunction(() => document.querySelector(".overlay-scrollbar").classList.contains("visible"));
    assert.equal(await gap(), 0, "显示滚动条不能挤压高亮行");
    await page.locator(".files-pane").screenshot({ path: "test-results/sidebar/scrollbar-overlay.png" });
    const box = await bar.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await page.locator("#git-index").evaluate(el => el.scrollTop);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40);
    await page.mouse.up();
    assert.ok(await page.locator("#git-index").evaluate(el => el.scrollTop) > before, "拖动浮动滑块应滚动内容");
    await page.waitForFunction(() => !document.querySelector(".overlay-scrollbar").classList.contains("visible"));
    assert.equal(await gap(), 0);
  } finally {
    await browser.close();
  }
});
