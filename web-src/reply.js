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
markdown.renderer.rules.fence = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0].toLowerCase();
  if (enhanced && language === "plot") {
    const plotIndex = env.plots.push(token.content) - 1;
    return `<div class="function-plot-block" data-plot="${plotIndex}"></div>\n`;
  }
  if (!enhanced || language !== "mermaid") {
    const rendered = defaultFence(tokens, index, options, env, renderer);
    return wrapCodeBlock(rendered, language, token.content);
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


let mounted=[];
function render(text) {

  mounted.forEach((item) => item.destroy());
  mounted = [];
  preview.replaceChildren();
  preview.dataset.state = text ? "rendering" : "idle";
  if (!text) return;

  const env = { diagrams: [], plots: [] };
  if (enhanced && detectType(text)) {
    env.diagrams.push(text);
    preview.innerHTML = '<div class="mermaid-diagram" data-diagram="0"></div>';
  } else {
    preview.innerHTML = markdown.render(text, env);
  }
  if (resolveImage) preview.querySelectorAll("img").forEach(img => {
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
  preview.querySelectorAll("code:not(pre code)").forEach(code => {
    if (code.closest("a")) return;
    const path = code.textContent;
    if (!/^(?:\.{0,2}\/)?[^\s<>`]+\.(?:md|mdx|markdown|[cm]?[jt]sx?|json|go|py|rs|css|html|ya?ml|toml|sh|txt)(?::\d+(?::\d+)?)?(?:#L\d+)?$/i.test(path)) return;
    const link = document.createElement("a"); link.setAttribute("href", path);
    code.replaceWith(link); link.append(code);
  });

  const failed = new Set();
  const summary = document.createElement("p");
  summary.className = "docmeta";
  // Migrated from VisualReply: derive the reading summary from rendered content.
  function updateSummary() {
    if (!showSummary) return;
    const body = preview.cloneNode(true);
    body.querySelector(".docmeta")?.remove();
    const words = (body.textContent.match(/[\u4e00-\u9fa5]|[a-zA-Z]+/g) || []).length;
    const parts = [];
    if (env.diagrams.length) parts.push(`${env.diagrams.length} diagram${env.diagrams.length > 1 ? "s" : ""}`);
    if (env.plots.length) parts.push(`${env.plots.length} plot${env.plots.length > 1 ? "s" : ""}`);
    if (preview.querySelector(".katex")) parts.push("math");
    if (words) parts.push(`${words} words`);
    if (failed.size) parts.push(`${failed.size} failed`);
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
    summary.dataset.state = failed.size ? "failed" : "done";
    const h1 = preview.querySelector("h1");
    if (h1) h1.after(summary); else preview.prepend(summary);
  }
  const updateStatus = () => {
    preview.dataset.state = failed.size ? "failed" : "done";
    updateSummary();
  };
  preview.querySelectorAll("[data-diagram]").forEach((container, index) => {
    mounted.push(mount(/** @type {HTMLElement} */ (container), env.diagrams[index], {
      idPrefix: `diagram-${index}-`,
      zoom: {
        always: true,
        labels: { zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Fit to view" },
      },
      onRender: () => {
        adjustDiagramContrast(container);
        container.classList.remove("diagram-error");
        failed.delete(index);
        updateStatus();
      },
      onError: (reason) => {
        const error = document.createElement("pre");
        error.setAttribute("role", "alert");
        error.textContent = String(reason);
        container.replaceChildren(error);
        container.classList.add("diagram-error");
        failed.add(index);
        updateStatus();
      },
    }));
  });
  preview.querySelectorAll("[data-plot]").forEach((container, index) => {
    mounted.push(mountPlot(container, env.plots[index], (reason) => {
      const error = document.createElement("pre");
      error.setAttribute("role", "alert");
      error.textContent = `Could not render plot: ${String(reason)}`;
      container.replaceChildren(error);
      container.classList.add("diagram-error");
      failed.add(`plot-${index}`);
      updateStatus();
    }));
  });
  updateStatus();
}


return {render, destroy(){mounted.forEach(item=>item.destroy());mounted=[];preview.replaceChildren();}};
}
