import { createReplyRenderer } from "./reply.js";
import { mountDiff } from "./diff.js";
import { diffFile } from "../src/diff.ts";
import { setupTheme } from "./theme.js";

const $ = id => document.getElementById(id);
const tabs = [];
let active, nextId = 0, renderer, diff, timer;
const paperRoot = document.createElement("div");
paperRoot.className = "reply-pane scratch-preview";
const current = () => tabs.find(t => t.id === active);
const nonempty = t => !!(t.text || t.before || t.after);
const dirty = () => tabs.some(nonempty);
function tabsView() {
  $("scratch-tabs").replaceChildren();
  for (const tab of tabs) {
    const wrapper = document.createElement("div"); wrapper.className = "tab";
    const select = document.createElement("button"); select.className = "tab-select"; select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", String(tab.id === active)); select.textContent = tab.name;
    select.onclick = () => { active = tab.id; render(); };
    const close = document.createElement("button"); close.className = "tab-close"; close.textContent = "×";
    close.setAttribute("aria-label", "关闭 " + tab.name); close.onclick = () => closeTab(tab.id);
    wrapper.append(select, close); $("scratch-tabs").append(wrapper);
  }
}
function create(kind = "doc") {
  const tab = { id: ++nextId, kind, name: kind === "doc" ? "untitled" : "untitled diff", named: false, view: kind === "doc" ? "split" : "edit", text: "", before: "", after: "" };
  tabs.push(tab); active = tab.id; render();
}
function closeTab(id = active) {
  const index = tabs.findIndex(t => t.id === id); if (index < 0) return;
  if (nonempty(tabs[index]) && !confirm("关闭后临时内容将丢弃，是否继续？")) return;
  tabs.splice(index, 1); if (active === id) active = tabs[Math.min(index, tabs.length - 1)]?.id; render();
}
function textarea(tab, key, label, parent) {
  const pane = document.createElement("div"); pane.className = "scratch-input";
  const title = document.createElement("label"); title.textContent = label;
  const input = document.createElement("textarea"); input.spellcheck = false; input.value = tab[key];
  input.setAttribute("aria-label", label);
  if (key === "text") input.id = "scratch-source"; else input.dataset.side = key;
  input.oninput = () => {
    tab[key] = input.value;
    if (!tab.named && key === "text") {
      tab.name = tab.text.split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").slice(0, 50) || "untitled";
      tabsView(); $("scratch-name").value = tab.name;
    }
    clearTimeout(timer); timer = setTimeout(() => renderer?.render(tab.text), 150);
  };
  pane.append(title, input); parent.append(pane);
}
function render() {
  clearTimeout(timer); renderer?.destroy(); renderer = undefined; diff?.destroy(); diff = undefined;
  tabsView(); const host = $("scratch-work"); host.replaceChildren(); const tab = current();
  if (!tab) { const empty = document.createElement("p"); empty.className = "scratch-empty"; empty.textContent = "没有打开的标签页 · ⌘T 新建"; host.append(empty); return; }
  const bar = document.createElement("div"); bar.className = "scratch-bar";
  const title = document.createElement("input"); title.id = "scratch-name"; title.value = tab.name; title.setAttribute("aria-label", "标签页名称");
  title.onchange = () => { tab.name = title.value.trim() || "untitled"; tab.named = true; tabsView(); };
  bar.append(title);
  for (const view of tab.kind === "doc" ? ["source", "split", "preview"] : ["edit", "diff"]) {
    const b = document.createElement("button"); b.dataset.view = view; b.textContent = view[0].toUpperCase() + view.slice(1);
    b.setAttribute("aria-pressed", String(tab.view === view)); b.onclick = () => { tab.view = view; render(); }; bar.append(b);
  }
  const panes = document.createElement("div"); panes.className = "scratch-panes";
  panes.classList.toggle("single", tab.kind === "doc" ? tab.view !== "split" : tab.view === "diff");
  host.append(bar, panes);
  if (tab.kind === "doc") {
    if (tab.view !== "preview") textarea(tab, "text", "Markdown source", panes);
    if (tab.view !== "source") {
      const article = document.createElement("article"); article.className = "markdown-body";
      paperRoot.replaceChildren(article); panes.append(paperRoot);
      renderer = createReplyRenderer(article, { enhanced: false }); renderer.render(tab.text);
    }
  } else if (tab.view === "edit") {
    textarea(tab, "before", "旧文本", panes); textarea(tab, "after", "新文本", panes);
  } else {
    const surface = document.createElement("div"); surface.className = "diff-surface"; panes.append(surface);
    const data = diffFile(tab.name, tab.before, tab.after);
    diff = mountDiff(surface, { path: tab.name, status: "临时对照", added: data.addedLines, deleted: data.deletedLines, diff: data }, () => { tab.view = "edit"; render(); }, { initialLayout: "split" });
    surface.querySelector("[data-open]").remove();
    surface.querySelector(".layout-switch").remove();
  }
}
setupTheme(paperRoot, () => { if (current()) render(); });
$("new-doc").onclick = () => create("doc"); $("new-diff").onclick = () => create("diff");
$("tabs-layout").onclick = () => {
  const vertical = $("scratch-shell").classList.toggle("vertical");
  $("tabs-layout").textContent = vertical ? "横向标签" : "纵向标签";
  $("tabs-layout").setAttribute("aria-pressed", String(vertical));
};
function command(name) {
  if (name === "new-tab") create("doc");
  if (name === "new-diff") create("diff");
  if (name === "close-tab") closeTab();
  if (name.startsWith("tab:")) { const tab = tabs[Number(name.slice(4)) - 1]; if (tab) { active = tab.id; render(); } }
}
window.reviewDesktop = { dirty, command, canClose: () => !dirty() || confirm("关闭后全部临时内容将丢弃，是否继续？") };
window.addEventListener("beforeunload", e => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("keydown", e => {
  if (!e.metaKey && !e.ctrlKey) return;
  if (e.key.toLowerCase() === "s") { e.preventDefault(); return; }
  if (window.mygo) return;
  const name = { t: "new-tab", w: "close-tab" }[e.key.toLowerCase()] || (/^[1-9]$/.test(e.key) ? "tab:" + e.key : "");
  if (name) { e.preventDefault(); command(name); }
});
render();
