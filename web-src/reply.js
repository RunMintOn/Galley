import { detectType, mount } from "pele";
import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import mark from "markdown-it-mark";
import { katex } from "@mdit/plugin-katex";
import { mountPlot } from "./plot.js";
import { adjustDiagramContrast } from "./diagram-contrast.js";

export function createReplyRenderer(preview, { enhanced = true, resolveImage, summary: showSummary = true } = {}) {
const markdown = new MarkdownIt({ html: false, breaks: true })
  .use(taskLists)
  .use(footnote)
  .use(sub)
  .use(sup)
  .use(mark);
if (enhanced) markdown.use(katex, {
    delimiters: "all",
    mathFence: true,
    throwOnError: false,
    trust: false,
  });
preview.addEventListener("click", (event) => {
  // Code blocks are produced as an HTML string and parsed by innerHTML, which
  // drops any listener attached before serialisation; handle copy here instead.
  const copy = event.target.closest(".code-copy");
  if (copy) {
    copyCodeBlock(copy);
    return;
  }
  const link = event.target.closest(".footnote-ref a, .footnote-backref");
  if (!link) return;
  const target = document.getElementById(link.hash.slice(1));
  if (!target) return;
  // The URL fragment carries the reply; footnote jumps must not replace it.
  event.preventDefault();
  target.scrollIntoView({ block: "nearest" });
});

async function copyCodeBlock(copy) {
  const pre = copy.closest(".code-block")?.querySelector("pre");
  if (!pre) return;
  const text = pre.textContent;
  const action = copy.querySelector(".code-copy-label");
  copy.dataset.state = "done";
  let label = "copied";
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard access can be refused; selecting the block still lets the reader copy it.
    const range = document.createRange();
    range.selectNodeContents(pre);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    label = "press ⌘C";
  }
  if (action) action.textContent = label;
  clearTimeout(copy.resetTimer);
  copy.resetTimer = setTimeout(() => {
    if (action) action.textContent = "copy";
    delete copy.dataset.state;
  }, 1600);
}
const defaultFence = markdown.renderer.rules.fence;
let codeCache = new Map(), nextCodeCache;
markdown.renderer.rules.fence = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0].toLowerCase();
  if (enhanced && language === "plot") {
    const plotIndex = env.plots.push(token.content) - 1;
    return `<div class="function-plot-block" data-plot="${plotIndex}"></div>\n`;
  }
  if (!enhanced || language !== "mermaid") {
    const key = token.info + "\0" + token.content;
    if (!nextCodeCache.has(key)) nextCodeCache.set(key, codeCache.get(key) ??
      wrapCodeBlock(defaultFence(tokens, index, options, env, renderer), language, token.content));
    return nextCodeCache.get(key);
  }
  const diagramIndex = /** @type {{diagrams: string[]}} */ (env).diagrams.push(token.content) - 1;
  return `<div class="mermaid-diagram" data-diagram="${diagramIndex}"></div>\n`;
};

/* ── code blocks (highlighting, language label, copy) ──────────────────────
   markdown-it emits a bare <pre><code>. Highlighting runs on the code text, then
   the wrapper carries the fence language and the copy affordance. */
function wrapCodeBlock(html, language, code) {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const pre = holder.firstElementChild;
  if (!pre || pre.tagName !== "PRE") return html;
  const codeEl = pre.querySelector("code");

  if (codeEl && language && hljs.getLanguage(language)) {
    try {
      codeEl.innerHTML = hljs.highlight(code, { language, ignoreIllegals: true }).value;
      codeEl.classList.add("hljs");
    } catch {
      // An unsupported or malformed fence stays plain rather than failing the render.
    }
  }

  const wrapper = document.createElement("div");
  wrapper.className = "code-block";
  // The language label lives inside the copy button and swaps to "copy" on hover,
  // so the header row is the affordance instead of an extra line of chrome.
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "code-copy";
  if (language) {
    const label = document.createElement("span");
    label.className = "code-lang";
    label.textContent = language;
    copy.append(label);
  }
  const action = document.createElement("span");
  action.className = "code-copy-label";
  action.textContent = "copy";
  copy.append(action);
  if (!language) copy.dataset.emptyLabel = "true";
  wrapper.append(copy, pre);
  return wrapper.outerHTML;
}


let blocks = [], appearance = "", diagramId = 0, currentText = "", summaryPending = false;
const summary = document.createElement("p");
summary.className = "docmeta";
function updateSummary() {
  summaryPending = false;
  if (!showSummary || !currentText) return;
  summary.remove();
  const words = (preview.textContent.match(/[\u4e00-\u9fa5]|[a-zA-Z]+/g) || []).length;
  const diagrams = blocks.reduce((n, block) => n + block.diagrams.length, 0);
  const plots = blocks.reduce((n, block) => n + block.plots.length, 0);
  const failed = blocks.reduce((n, block) => n + block.failed.size, 0);
  const parts = [];
  if (diagrams) parts.push(`${diagrams} diagram${diagrams > 1 ? "s" : ""}`);
  if (plots) parts.push(`${plots} plot${plots > 1 ? "s" : ""}`);
  if (preview.querySelector(".katex")) parts.push("math");
  if (words) parts.push(`${words} words`);
  if (failed) parts.push(`${failed} failed`);
  const swatch = document.createElement("span"); swatch.className = "swatch"; swatch.setAttribute("aria-hidden", "true");
  summary.replaceChildren(swatch);
  for (const text of parts) {
    const item = document.createElement("span"); item.textContent = text;
    if (summary.childElementCount > 1) {
      const rule = document.createElement("span"); rule.className = "rule"; rule.setAttribute("aria-hidden", "true");
      summary.append(rule);
    }
    summary.append(item);
  }
  summary.dataset.state = failed ? "failed" : "done";
  const h1 = preview.querySelector("h1");
  if (h1) h1.after(summary); else preview.prepend(summary);
}
function updateStatus() {
  preview.dataset.state = !currentText ? "idle" : blocks.some(block => block.failed.size) ? "failed" : "done";
  if (showSummary && !summaryPending) { summaryPending = true; queueMicrotask(updateSummary); }
}
function removeBlock(block) {
  block.alive = false;
  block.mounted.forEach(item => item.destroy());
  block.nodes.forEach(node => node.remove());
}
function mountBlock(block, before) {
  const template = document.createElement("template");
  template.innerHTML = block.html;
  const fragment = template.content;
  if (resolveImage) fragment.querySelectorAll("img").forEach(img => {
    const source = img.getAttribute("src");
    if (/^(https?:|data:|blob:)/i.test(source)) return;
    img.removeAttribute("src");
    Promise.resolve().then(() => resolveImage(source)).then(url => {
      if (preview.contains(img)) img.src = url;
    }).catch(error => {
      if (preview.contains(img)) { img.classList.add("image-missing"); img.title = error.message; }
    });
  });
  // Only isolated inline path tokens become links; code blocks remain literal.
  fragment.querySelectorAll("code:not(pre code)").forEach(code => {
    if (code.closest("a")) return;
    const path = code.textContent;
    if (!/^(?:\.{0,2}\/)?[^\s<>`]+\.(?:md|mdx|markdown|[cm]?[jt]sx?|json|go|py|rs|css|html|ya?ml|toml|sh|txt)(?::\d+(?::\d+)?)?(?:#L\d+)?$/i.test(path)) return;
    const link = document.createElement("a"); link.setAttribute("href", path);
    code.replaceWith(link); link.append(code);
  });

  const diagrams = [...fragment.querySelectorAll("[data-diagram]")];
  const plots = [...fragment.querySelectorAll("[data-plot]")];
  block.nodes = [...fragment.childNodes];
  preview.insertBefore(fragment, before);
  diagrams.forEach((container, index) => {
    block.mounted.push(mount(/** @type {HTMLElement} */ (container), block.diagrams[index], {
      idPrefix: `diagram-${diagramId++}-`,
      zoom: {
        always: true,
        labels: { zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Fit to view" },
      },
      onRender: () => {
        if (!block.alive) return;
        adjustDiagramContrast(container);
        container.classList.remove("diagram-error");
        block.failed.delete(container);
        updateStatus();
      },
      onError: (reason) => {
        if (!block.alive) return;
        const error = document.createElement("pre");
        error.setAttribute("role", "alert");
        error.textContent = String(reason);
        container.replaceChildren(error);
        container.classList.add("diagram-error");
        block.failed.add(container);
        updateStatus();
      },
    }));
  });
  plots.forEach((container, index) => {
    block.mounted.push(mountPlot(container, block.plots[index], (reason) => {
      if (!block.alive) return;
      const error = document.createElement("pre");
      error.setAttribute("role", "alert");
      error.textContent = `Could not render plot: ${String(reason)}`;
      container.replaceChildren(error);
      container.classList.add("diagram-error");
      block.failed.add(container);
      updateStatus();
    }));
  });
}

function render(text) {
  currentText = text;
  summary.remove();
  nextCodeCache = new Map();
  const next = [];
  const env = {};
  const append = html => next.push({ html, diagrams: env.diagrams, plots: env.plots, mounted: [], nodes: [], failed: new Set(), alive: true });
  if (text && enhanced && detectType(text)) {
    env.diagrams = [text]; env.plots = [];
    append('<div class="mermaid-diagram" data-diagram="0"></div>');
  } else if (text) {
    // Parse the whole document so references and footnotes remain global. Render
    // balanced top-level token groups so unchanged DOM can stay mounted.
    const tokens = markdown.parse(text, env);
    for (let start = 0; start < tokens.length;) {
      let end = start, depth = 0;
      do { depth += tokens[end++].nesting; } while (depth > 0 && end < tokens.length);
      env.diagrams = []; env.plots = [];
      append(markdown.renderer.render(tokens.slice(start, end), markdown.options, env));
      start = end;
    }
  }
  codeCache = nextCodeCache;
  const same = (a, b) => a.html === b.html &&
    a.diagrams.length === b.diagrams.length && a.diagrams.every((text, i) => text === b.diagrams[i]) &&
    a.plots.length === b.plots.length && a.plots.every((text, i) => text === b.plots[i]);
  const theme = `${document.documentElement.classList.contains("dark")}:${document.documentElement.dataset.font}:${preview.closest("[data-paper]")?.dataset.paper}`;
  let prefix = 0, suffix = 0;
  if (theme === appearance) {
    while (prefix < blocks.length && prefix < next.length && same(blocks[prefix], next[prefix])) prefix++;
    while (suffix < blocks.length - prefix && suffix < next.length - prefix &&
      same(blocks[blocks.length - suffix - 1], next[next.length - suffix - 1])) suffix++;
  }
  appearance = theme;
  const previous = blocks;
  for (let i = 0; i < prefix; i++) next[i] = previous[i];
  for (let i = 0; i < suffix; i++) next[next.length - i - 1] = previous[previous.length - i - 1];
  previous.slice(prefix, previous.length - suffix).forEach(removeBlock);
  blocks = next;
  const before = suffix ? next[next.length - suffix].nodes[0] : null;
  for (let i = prefix; i < next.length - suffix; i++) mountBlock(next[i], before);
  updateStatus();
}

return { render, destroy() {
  currentText = "";
  blocks.forEach(removeBlock); blocks = []; codeCache.clear(); summary.remove(); preview.replaceChildren();
} };
}
