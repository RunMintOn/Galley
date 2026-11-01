import { createReplyRenderer } from "./reply.js";
import { mountDiff } from "./diff.js";
import { diffFile } from "../src/diff.ts";
import { setupTheme, setupPreviewPreference, defaultPreview } from "./theme.js";
import { createScratchEditor, editHistory, findInEditor } from "./editor.js";
import { imageData, rebaseImages } from "./images.js";

const $ = id => document.getElementById(id);
document.documentElement.classList.toggle("desktop", !!window.mygo);
const tabs = [];
let active, nextId = 0, renderer, diff, timer;
let editors = [];
const paperRoot = document.createElement("div");
paperRoot.className = "reply-pane scratch-preview";
const current = () => tabs.find(t => t.id === active);
const changed = t => t.kind === "doc" ? t.text !== t.saved : !!(t.before || t.after);
const dirty = () => tabs.some(t => changed(t) || t.saving);
const native = (method, ...args) => window.mygo.call("Desktop." + method, ...args);
function report(error) { $("scratch-status").textContent = error.message; }
const run = fn => async (...args) => { try { return await fn(...args); } catch (e) { report(e); } };
const basename = path => path.split("/").at(-1);
function tabsView() {
  $("scratch-tabs").replaceChildren();
  for (const tab of tabs) {
    const wrapper = document.createElement("div"); wrapper.className = "tab";
    const select = document.createElement("button"); select.className = "tab-select"; select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", String(tab.id === active));
    select.textContent = tab.name; select.title = tab.path || tab.name;
    if (changed(tab)) {
      const dot = document.createElement("span"); dot.className = "unsaved-dot"; dot.textContent = " •"; dot.setAttribute("aria-label", "Unsaved"); select.append(dot);
    }
    select.onclick = () => { active = tab.id; render(); };
    const close = document.createElement("button"); close.className = "tab-close";
    close.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
    close.setAttribute("aria-label", "Close " + tab.name); close.onclick = run(() => closeTab(tab.id));
    wrapper.append(select, close); $("scratch-tabs").append(wrapper);
  }
  document.title = (current()?.name || "Markdown") + (current() && changed(current()) ? " •" : "") + " · Galley";
}
function create(kind = "doc", doc) {
  if (doc) {
    const existing = tabs.find(t => t.path === doc.path);
    if (existing) { active = existing.id; render(); return; }
  }
  const tab = {
    id: ++nextId, kind, name: doc ? basename(doc.path) : kind === "doc" ? "untitled" : "untitled diff",
    named: !!doc, path: doc?.path || "", version: doc?.version || "", saved: doc?.content || "",
    view: kind === "doc" ? (doc && defaultPreview() ? "preview" : "split") : "edit",
    text: doc?.content || "", before: "", after: "", editors: {}, images: new Map(),
  };
  tabs.push(tab); active = tab.id; render();
}
async function openFiles() {
  if (!window.mygo) { $("scratch-status").textContent = "Open and save local files in the desktop app"; return; }
  for (const doc of await native("PickDocuments")) create("doc", doc);
}
async function openPending() {
  for (const path of await native("PendingDocuments") || []) {
    try { create("doc", await native("ReadDocument", path)); } catch (e) { report(e); }
  }
}
async function allowClose(tab) {
  if (tab.saving) return false;
  if (!changed(tab)) return true;
  if (tab.kind === "diff") return confirm("The temporary diff will be discarded when closed. Continue?");
  if (!window.mygo) return confirm("The temporary content will be discarded when closed. Continue?");
  const choice = await native("ConfirmClose", tab.name);
  if (choice === 2) return false;
  if (choice === 1) return true;
  return save(tab);
}
async function closeTab(id = active) {
  const tab = tabs.find(t => t.id === id);
  if (!tab || !await allowClose(tab)) return;
  const index = tabs.indexOf(tab);
  tabs.splice(index, 1); if (active === id) active = tabs[Math.min(index, tabs.length - 1)]?.id; render();
}
async function canClose() {
  for (const tab of tabs) if (!await allowClose(tab)) return false;
  return true;
}
async function pasteImages(tab, files) {
  for (const file of files) {
    const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1].replace("+xml", "");
    const name = `image-${crypto.randomUUID()}.${ext}`;
    const data = await imageData(file);
    tab.images.set(name, data);
    tab.liveEditor.insert(`![Image](attachment:${name})\n`);
  }
}
async function save(tab = current(), saveAs = false) {
  if (!tab || tab.kind !== "doc" || tab.saving) return false;
  if (!window.mygo) { $("scratch-status").textContent = "Save local files in the desktop app"; return false; }
  tab.saving = true;
  try {
    const path = !tab.path || saveAs ? await native("PickSavePath", tab.path || tab.name.replace(/\.md$/i, "") + ".md") : tab.path;
    if (!path) return false;
    let text = tab.text;
    if (tab.path && tab.path !== path) text = await rebaseImages(text, paths => native("RebaseImagePaths", tab.path, path, paths));
    const assets = basename(path).replace(/\.[^.]+$/, "") + ".assets";
    const images = [];
    for (const [name, data] of tab.images) {
      if (!text.includes("attachment:" + name)) continue;
      text = text.replaceAll("attachment:" + name, encodeURI(assets + "/" + name));
      images.push({ name, data: data.slice(data.indexOf(",") + 1) });
    }
    const draft = tab.text;
    let result;
    try {
      result = await native("WriteDocument", { path, content: text, version: path === tab.path ? tab.version : "", images });
    } catch (e) {
      if (!e.message.includes("changed on disk") || !confirm("The file changed on disk. Overwrite it with the current draft? Cancel keeps the draft.")) throw e;
      result = await native("WriteDocument", { path, content: text, version: "", images });
    }
    tab.path = result.path; tab.version = result.version; tab.saved = result.content;
    tab.name = basename(result.path); tab.named = true; tab.conflict = false;
    // Only replace the snapshot that was written; typing during a save stays dirty.
    if (tab.text === draft) {
      if (tab.text !== text) {
        tab.text = text;
        if (tab.id === active && tab.liveEditor) tab.liveEditor.setText(text);
        else delete tab.editors.text;
      }
    }
    tabsView();
    if (tab.id === active) { $("scratch-name").value = tab.name; $("scratch-status").textContent = changed(tab) ? "Still unsaved" : "Saved"; renderPreview(tab); }
    return !changed(tab);
  } finally { tab.saving = false; }
}
function renderPreview(tab) { renderer?.render(tab.text); }
function sourceEditor(tab, key, label, parent) {
  const pane = document.createElement("div"); pane.className = "scratch-input";
  if (key !== "text") { const title = document.createElement("label"); title.textContent = label; pane.append(title); }
  const host = document.createElement("div"); host.className = "editor-host";
  if (key === "text") host.id = "scratch-source"; else host.dataset.side = key;
  pane.append(host); parent.append(pane);
  const editor = createScratchEditor(host, {
    ...tab.editors[key], text: tab[key], label, isMarkdown: key === "text",
    onPasteImages: key === "text" ? run(files => pasteImages(tab, files)) : undefined,
    onChange: text => {
      tab[key] = text;
      if (!tab.named && key === "text") tab.name = text.split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").slice(0, 50) || "untitled";
      tabsView(); $("scratch-name").value = tab.name;
      clearTimeout(timer); timer = setTimeout(() => renderPreview(tab), 150);
    },
  });
  if (key === "text") tab.liveEditor = editor;
  editors.push(() => { tab.editors[key] = editor.snapshot(); editor.destroy(); if (key === "text") tab.liveEditor = undefined; });
}
function render() {
  editors.forEach(dispose => dispose()); editors = [];
  for (const tab of tabs) if (tab.reloaded) { delete tab.editors.text; tab.reloaded = false; }
  clearTimeout(timer); renderer?.destroy(); renderer = undefined; diff?.destroy(); diff = undefined;
  tabsView(); const host = $("scratch-work"); host.replaceChildren(); const tab = current();
  if (!tab) { const empty = document.createElement("p"); empty.className = "scratch-empty"; empty.textContent = "Open a Markdown file, or press ⌘T to create one"; host.append(empty); return; }
  const bar = document.createElement("div"); bar.className = "scratch-bar";
  const title = document.createElement("input"); title.id = "scratch-name"; title.value = tab.name; title.setAttribute("aria-label", "Tab name");
  title.readOnly = !!tab.path; title.title = tab.path;
  title.onchange = () => { tab.name = title.value.trim() || "untitled"; tab.named = true; tabsView(); };
  const views = document.createElement("nav"); views.className = "segmented"; views.setAttribute("aria-label", tab.kind === "doc" ? "Document view" : "Diff view");
  for (const view of tab.kind === "doc" ? ["source", "split", "preview"] : ["edit", "diff"]) {
    const b = document.createElement("button"); b.dataset.view = view;
    b.textContent = { source: "Source", split: "Split", preview: "Preview", edit: "Edit", diff: "Diff" }[view];
    b.setAttribute("aria-pressed", String(tab.view === view)); b.onclick = () => { tab.view = view; render(); }; views.append(b);
  }
  bar.append(title, views);
  const panes = document.createElement("div"); panes.className = "scratch-panes";
  panes.classList.toggle("single", tab.kind === "doc" ? tab.view !== "split" : tab.view === "diff");
  host.append(bar, panes);
  if (tab.kind === "doc") {
    if (tab.view !== "preview") sourceEditor(tab, "text", "Markdown source", panes);
    if (tab.view !== "source") {
      const article = document.createElement("article"); article.className = "markdown-body";
      paperRoot.replaceChildren(article); panes.append(paperRoot);
      renderer = createReplyRenderer(article, {
        summary: false,
        resolveImage: source => source.startsWith("attachment:") ? tab.images.get(source.slice(11)) : tab.path ? native("ReadImage", tab.path, source) : Promise.reject(new Error("Save the document before locating images")),
      });
      renderPreview(tab);
    }
  } else if (tab.view === "edit") {
    sourceEditor(tab, "before", "Before", panes); sourceEditor(tab, "after", "After", panes);
  } else {
    const holder = document.createElement("div"); holder.className = "diff-doc";
    const toolbar = document.createElement("div"); toolbar.className = "doc-toolbar";
    const surface = document.createElement("div"); surface.className = "diff-surface";
    holder.append(toolbar, surface); panes.append(holder);
    const data = diffFile(tab.name, tab.before, tab.after);
    diff = mountDiff(surface, { path: tab.name, status: "Temporary comparison", added: data.addedLines, deleted: data.deletedLines, diff: data }, () => { tab.view = "edit"; render(); }, { initialLayout: "split", toolbar });
    toolbar.querySelector("[data-open]")?.remove();
    toolbar.querySelector(".segmented")?.remove();
  }
  $("save-doc").disabled = tab.kind !== "doc";
  $("scratch-status").textContent = tab.conflict ? "File changed on disk; draft kept" : changed(tab) ? "Unsaved" : tab.path || "";
}
async function recheck() {
  if (!window.mygo || document.visibilityState !== "visible") return;
  for (const tab of tabs.filter(t => t.path && !t.saving)) {
    try {
      const doc = await native("ReadDocument", tab.path);
      if (doc.version === tab.version) continue;
      if (changed(tab)) {
        tab.conflict = true;
        if (tab.id === active) $("scratch-status").textContent = "File changed on disk; draft kept. Save to overwrite or reload.";
      } else {
        tab.text = tab.saved = doc.content; tab.version = doc.version; tab.reloaded = true;
        if (tab.id === active) render();
      }
    } catch (e) { report(e); }
  }
}
async function reload() {
  const tab = current();
  if (!tab?.path || (changed(tab) && !confirm("Discard the current changes and reload from disk?"))) return;
  const doc = await native("ReadDocument", tab.path);
  tab.text = tab.saved = doc.content; tab.version = doc.version; tab.conflict = false; tab.reloaded = true; render();
}
setupTheme(paperRoot, () => { if (current()) render(); });
setupPreviewPreference();
$("new-doc").onclick = () => create("doc"); $("new-diff").onclick = () => create("diff");
$("open-doc").onclick = run(openFiles); $("save-doc").onclick = run(() => save());
$("reload-doc").onclick = run(reload);
$("tabs-layout").onclick = () => {
  const vertical = $("scratch-shell").classList.toggle("vertical");
  $("tabs-layout").textContent = vertical ? "Horizontal tabs" : "Vertical tabs";
  $("tabs-layout").setAttribute("aria-pressed", String(vertical));
};
const command = run(async name => {
  if (name === "undo" || name === "redo") editHistory(name);
  if (name === "new-tab") create("doc");
  if (name === "new-diff") create("diff");
  if (name === "open-file") await openFiles();
  if (name === "save" || name === "save-as") await save(current(), name === "save-as");
  if (name === "find" || name === "replace") {
    if (current()?.view === "preview") { current().view = "source"; render(); }
    findInEditor($("scratch-work"));
  }
  if (name === "close-tab") await closeTab();
  if (name.startsWith("tab:")) { const tab = tabs[Number(name.slice(4)) - 1]; if (tab) { active = tab.id; render(); } }
});
window.reviewDesktop = { dirty, command, canClose: run(canClose), openPending: run(openPending) };
window.addEventListener("beforeunload", e => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("focus", () => run(recheck)());
document.addEventListener("visibilitychange", () => run(recheck)());
setInterval(() => { if (document.hasFocus()) run(recheck)(); }, 2000);
document.addEventListener("keydown", e => {
  if (!e.metaKey && !e.ctrlKey) return;
  if (window.mygo) return;
  const name = { s: e.shiftKey ? "save-as" : "save", o: "open-file", t: "new-tab", w: "close-tab", f: "find" }[e.key.toLowerCase()] || (/^[1-9]$/.test(e.key) ? "tab:" + e.key : "");
  if (name) { e.preventDefault(); command(name); }
});
if (window.mygo) await run(openPending)();
if (!tabs.length) create("doc");
