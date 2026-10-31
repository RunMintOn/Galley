import { mountDiff } from "./diff.js";
import { createReplyRenderer } from "./reply.js";
import { createFileEditor, editHistory, findInEditor } from "./editor.js";
import { showGitHistory } from "./git-view.js";
import { setupTheme, setupPreviewPreference, defaultPreview } from "./theme.js";
import { imageData, projectImage, relativeFilePath, isImagePath, imagePreview } from "./images.js";
import { createFileExplorer } from "./file-explorer.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
if (params.get("token")) sessionStorage.setItem("review-token", params.get("token"));
const token = sessionStorage.getItem("review-token") || "";
history.replaceState(null, "", location.pathname);
const state = { projects: [], sessions: [], root: params.get("root") || "", session: params.get("session") || "", round: "", data: null, file: "", mode: "turn" };
let generation = 0;
let renderer = createReplyRenderer($("document"));
let diff;
const positions = new Map();
let renderTimer;
let editor, currentFile, removedFile;
let fileRenderer, filePreviewTimer;
let savingFile = false;
let sourceOpen = false;
let disposeHistory;
let socket;
let reconnectTimer, stopped = false, inputSession = "", sending = false, temporaryPreview = false;
const drafts = new Map();
const projectSessions = new Map();
const branches = new Map();
const pendingBranches = new Set();
let contextProject;
let changedTree = false;
let foreground = document.visibilityState === "visible" && document.hasFocus();
const expanded = new Set([""]);
const canvas = $("document").parentElement;
function updateProgress() {
  const max = canvas.scrollHeight - canvas.clientHeight;
  $("progress").firstElementChild.style.transform = `scaleX(${max > 4 ? Math.min(canvas.scrollTop / max, 1) : 0})`;
  $("progress").dataset.idle = String(max <= 4);
}
canvas.addEventListener("scroll", updateProgress, { passive: true });
const progressObserver = new ResizeObserver(updateProgress);
progressObserver.observe($("document"));
function leaveFile() {
  if (savingFile) { notice("Saving. Wait for confirmation before switching."); return false; }
  if (editor?.dirty && !confirm("There are unsaved changes. Discard them and switch?")) return false;
  diff?.destroy(); diff = undefined;
  clearTimeout(filePreviewTimer); fileRenderer?.destroy(); fileRenderer = undefined;
  editor?.destroy(); editor = undefined; currentFile = undefined; return true;
}
function indexMode(git = false) {
  $("review-index").hidden = git;
  $("git-index").hidden = !git;
  $("files-pane").classList.toggle("git-mode", git);
}
function closeHistory() { disposeHistory?.(); disposeHistory = undefined; indexMode(); }
function contentFooter() { return $("content-pane").querySelector("footer"); }
function restoreContentHeader() {
  if (state.mode === "history") contentIdentity("Git history");
  else if (state.mode === "file" && currentFile) contentIdentity(currentFile.path);
  else if (state.mode === "turn" && state.file) contentIdentity(state.file, state.data?.report?.files.find(f => f.path === state.file));
  else contentIdentity();
}
function setSource(open) {
  sourceOpen = open;
  if (open && $("content-pane").classList.contains("collapsed")) { setPane("files-pane", false); setPane("content-pane", false); }
  $("content").hidden = open;
  $("doc-toolbar").hidden = open || !$("doc-toolbar").children.length;
  $("source-toolbar").hidden = !open;
  $("source-view").hidden = !open;
  contentFooter().hidden = open || state.mode !== "turn";
  if (open) {
    $("content-name").replaceChildren(document.createTextNode("Reply source"));
    $("content-name").title = "Reply source";
    $("content-counts").replaceChildren();
  } else restoreContentHeader();
  $("show-source").setAttribute("aria-pressed", String(open));
}
export function notice(message, action) {
  $("notice-text").textContent = message;
  $("notice").hidden = !message;
  $("notice-undo").hidden = !action;
  $("notice-undo").textContent = action?.label || "Undo";
  $("notice-undo").onclick = action ? run(async () => {
    $("notice-undo").disabled = true;
    try { await action.run(); } finally { $("notice-undo").disabled = false; }
  }) : null;
}
$("notice-close").onclick = () => { $("notice").hidden = true; };
export async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch("/api/" + path, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
const run = fn => async (...args) => { try { await fn(...args); } catch (e) { notice(e.message); } };
const session = () => state.sessions.find(s => s.id === state.session);
function button(text, handler, className) {
  const b = document.createElement("button"); b.textContent = text; b.onclick = run(handler); if (className) b.className = className; return b;
}
function option(value, text) { const o = document.createElement("option"); o.value = value; o.textContent = text; return o; }
function counts(added, deleted) {
  return [["added", added, "+"], ["deleted", deleted, "−"]].filter(([, n]) => n).map(([className, n, sign]) => {
    const span = document.createElement("span"); span.className = className; span.textContent = sign + n; return span;
  });
}
const MARKDOWN_EXT = new Set(["md", "markdown", "mdx"]);
const CONFIG_EXT = new Set(["json", "jsonc", "toml", "yaml", "yml", "ini", "conf", "cfg", "mod", "sum", "lock", "env"]);
const CODE_EXT = new Set(["js", "mjs", "cjs", "jsx", "ts", "tsx", "go", "py", "rb", "rs", "java", "c", "h", "cc", "cpp", "hpp", "cs", "swift", "kt", "php", "sh", "bash", "zsh", "fish", "css", "scss", "less", "html", "htm", "xml", "sql", "lua", "r", "ex", "exs", "vue", "svelte"]);
function fileType(path) {
  const name = path.split("/").at(-1).toLowerCase();
  const ext = name.includes(".") ? name.split(".").at(-1) : "";
  if (MARKDOWN_EXT.has(ext)) return "markdown";
  if (isImagePath(path)) return "image";
  if (CONFIG_EXT.has(ext) || ["go.mod", "go.sum", "dockerfile", "makefile", ".env"].includes(name)) return "config";
  if (CODE_EXT.has(ext)) return "code";
  return null;
}
function fileIcon(path) {
  const icon = document.createElement("span"); icon.className = "file-icon"; icon.setAttribute("aria-hidden", "true");
  const type = fileType(path); if (type) icon.dataset.type = type;
  icon.innerHTML = '<svg class="icon"><use href="#i-file"/></svg>';
  return icon;
}
function fileButton(path, action, stats) {
  const b = button("", action, "file-button");
  b.dataset.path = path; b.title = path;
  const name = document.createElement("span"); name.className = "file-name";
  const basename = path.split("/").at(-1);
  const duplicate = stats && state.data?.report?.files.some(f => f.path !== path && f.path.split("/").at(-1) === basename);
  name.textContent = stats && !duplicate ? basename : path;
  b.append(fileIcon(path), name);
  if (stats) {
    const totals = document.createElement("span"); totals.className = "line-counts";
    totals.append(...counts(stats.added, stats.deleted)); b.append(totals);
  }
  return b;
}
function selectFile(path) {
  document.querySelectorAll("[data-path]").forEach(b => b.setAttribute("aria-current", String(b.dataset.path === path)));
}
function contentIdentity(name = "", stats) {
  $("content-name").replaceChildren();
  if (name) {
    const parts = name.split("/"), base = parts.pop(), dir = parts.join("/");
    if (dir) { const d = document.createElement("span"); d.className = "dir"; d.textContent = dir + "/"; $("content-name").append(d); }
    const b = document.createElement("span"); b.className = "base"; b.textContent = base; $("content-name").append(b);
  }
  $("content-name").title = name;
  $("content-counts").replaceChildren(...(stats?.status === "Unavailable" ? [document.createTextNode("Line counts unavailable")] : stats ? counts(stats.added, stats.deleted) : []));
  $("turn-tab").setAttribute("aria-pressed", String(state.mode === "turn"));
  $("history-tab").setAttribute("aria-pressed", String(state.mode === "history"));
}
function contentHeader(name = "", stats) {
  contentIdentity(name, stats);
  contentFooter().hidden = state.mode !== "turn";
  $("doc-toolbar").replaceChildren(); $("doc-toolbar").hidden = true;
  $("content-footer-actions").replaceChildren(); $("content-position").textContent = "";
}
function updateReplyContext() {
  const heading = $("document").querySelector("h1, h2, h3");
  const title = $("document").querySelector(".reply-empty") ? "" : heading?.textContent.trim() || session()?.title || "";
  $("reply-title").textContent = title;
  $("reply-title").title = title;
}
function projectLocation(root) {
  const parts = root.split("/").filter(Boolean);
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : root;
}
function refreshBranch(root) {
  if (!root || pendingBranches.has(root)) return;
  pendingBranches.add(root);
  api("git/head?" + new URLSearchParams({ root })).then(data => {
    branches.set(root, data.label || null);
  }).catch(() => {
    branches.set(root, null);
  }).finally(() => { pendingBranches.delete(root); renderProjects(); });
}
function renderProjects() {
  $("project-count").textContent = state.projects.length;
  $("move-project").disabled = state.projects.findIndex(p => p.root === state.root) <= 0;
  $("remove-project").disabled = !state.root;
  for (const id of ["new-file", "new-folder", "find-file", "collapse-tree"]) $(id).disabled = !state.root;
  const existing = new Map([...$("projects").children].map(row => [row.dataset.root, row]));
  const rows = state.projects.map(p => {
    const related = state.sessions.filter(s => s.root === p.root);
    const selected = related.find(s => s.id === (p.root === state.root ? state.session : projectSessions.get(p.root))) || related.at(-1);
    const working = related.some(s => s.state === "working");
    const b = existing.get(p.root) || button("", () => chooseProject(p.root), "project");
    b.dataset.root = p.root;
    b.setAttribute("aria-current", String(p.root === state.root)); b.title = p.root;
    b.oncontextmenu = event => {
      event.preventDefault();
      contextProject = p.root;
      $("project-context").hidden = false;
      $("project-context").style.left = Math.min(event.clientX, innerWidth - $("project-context").offsetWidth) + "px";
      $("project-context").style.top = Math.min(event.clientY, innerHeight - $("project-context").offsetHeight) + "px";
      $("context-remove-project").focus();
    };
    const dot = document.createElement("span");
    dot.className = "project-dot" + (working ? " working" : "");
    dot.title = working ? "Working" : "";
    const label = document.createElement("span"); label.className = "project-name"; label.textContent = p.name;
    const meta = document.createElement("span"); meta.className = "project-meta";
    if (!branches.has(p.root)) refreshBranch(p.root);
    const branch = branches.get(p.root);
    if (branch) { const span = document.createElement("span"); span.className = "branch"; span.textContent = branch; span.title = branch; meta.append(span); }
    const count = selected?.rounds.at(-1)?.count ?? 0;
    if (count > 0) { const chip = document.createElement("span"); chip.className = "project-count"; chip.textContent = count; meta.append(chip); }
    const path = document.createElement("span"); path.className = "project-path"; path.textContent = projectLocation(p.root);
    b.replaceChildren(dot, label, meta, path);
    return b;
  });
  for (const row of existing.values()) if (!rows.includes(row)) row.remove();
  rows.forEach((row, index) => {
    if ($("projects").children[index] !== row) $("projects").insertBefore(row, $("projects").children[index] || null);
  });
}
async function refresh() {
  const previousLatest = session()?.rounds.at(-1)?.id;
  const data = await api("projects");
  state.projects = data.projects;
  state.sessions = data.sessions.filter(s => state.projects.some(p => p.root === s.root));
  if (!state.projects.some(p => p.root === state.root)) state.root = state.sessions.find(s => s.id === state.session)?.root || state.projects[0]?.root || "";
  if (!state.sessions.some(s => s.id === state.session && s.root === state.root)) state.session = state.sessions.filter(s => s.root === state.root).at(-1)?.id || "";
  const selected = session();
  $("reply-pane").querySelector(".reply-navigation").hidden = !selected;
  if (selected) projectSessions.set(state.root, selected.id);
  const latest = selected?.rounds.at(-1)?.id || "";
  const wasFollowing = !editor && !temporaryPreview && !sourceOpen && (!state.round || state.round === previousLatest);
  if (wasFollowing) state.round = latest;
  renderProjects();
  $("sessions").replaceChildren(...state.sessions.filter(s => s.root === state.root).map(s => { const o = option(s.id, s.title); o.title = s.title; return o; }));
  $("sessions").value = state.session;
  $("sessions").disabled = !state.session;
  $("session-state").textContent = { offline: "Offline", idle: "Idle", working: "Working" }[selected?.state] || "No session";
  $("session-connection").dataset.connected = String(selected?.state === "idle" || selected?.state === "working");
  $("session-connection").dataset.state = selected?.state || "offline";
  $("toggle-input").disabled = !selected;
  if (inputSession !== state.session) {
    if (inputSession) drafts.set(inputSession, $("message-input").value);
    inputSession = state.session; $("message-input").value = drafts.get(inputSession) || "";
  }
  $("send").disabled = sending || selected?.state !== "idle";
  $("send-state").textContent = sending ? "Sending, waiting for pi…" : selected?.error || (selected?.state === "offline" ? "Session offline; drafts are local" : "");
  const rounds = selected?.rounds || [];
  $("rounds").replaceChildren(...rounds.map((r, i) => { const o = option(r.id, `${i + 1} / ${rounds.length}`); o.title = `${new Date(r.end).toLocaleString()} · ${r.outcome}`; return o; }));
  if (!rounds.length) $("rounds").append(option("", "0 / 0"));
  $("rounds").value = state.round;
  const at = rounds.findIndex(r => r.id === state.round);
  $("previous").disabled = at <= 0; $("next").disabled = at < 0 || at === rounds.length - 1;
  $("rounds").disabled = !rounds.length;
  $("latest").hidden = state.round === latest && !temporaryPreview;
  $("reading-state").textContent = temporaryPreview ? "Temporary preview" : "";
  if (!temporaryPreview) updateReplyContext();
  if (state.data?.id !== state.round || state.data?.sessionId !== state.session) await loadRound();
}
async function chooseProject(root) {
  if (!leaveFile()) return;
  setSource(false);
  closeHistory();
  state.root = root; state.session = projectSessions.get(root) || ""; state.round = ""; state.data = null; state.mode = "turn";
  await refresh(); await loadTree(); updateWatch();
}
export function savePosition() {
  if (state.data) positions.set(state.data.sessionId + ":" + state.data.id, $("document").parentElement.scrollTop);
}
export function hasUnsavedChanges() { return savingFile || !!editor?.dirty; }
export async function focusSession(hash) {
  if (!leaveFile()) return;
  setSource(false);
  closeHistory(); state.mode = "turn";
  const target = new URLSearchParams(hash.slice(1));
  state.session = target.get("session") || state.session;
  state.root = state.sessions.find(s => s.id === state.session)?.root || target.get("root") || state.root;
  state.round = ""; await refresh(); await loadTree(); updateWatch();
}
$("add-project").onclick = run(async () => {
  // The desktop shell opens the system picker; the browser build keeps the
  // text prompt, and a failed bridge call falls back to it rather than dying.
  let root = null;
  if (window.mygo) { try { root = await window.mygo.call("Desktop.PickFolder"); } catch { root = null; } }
  if (root === null) root = prompt("Full path to a local project folder");
  if (!root) return;
  const added = await api("projects", { root }); await refresh();
  await chooseProject(added.root);
});
document.addEventListener("click", e => {
  $("project-context").hidden = true;
  for (const menu of document.querySelectorAll("details.menu[open]")) {
    if (!menu.contains(e.target) || (menu.id === "project-menu" && e.target.closest("button"))) menu.open = false;
  }
});
async function removeProject(root) {
  const current = root === state.root;
  if (current) {
    if (!leaveFile()) return;
    setSource(false);
    closeHistory();
    expanded.clear(); expanded.add("");
    state.round = ""; state.data = null; state.mode = "turn";
  }
  await api("projects", { root }, "DELETE");
  await refresh();
  if (current) { await loadTree(); updateWatch(); }
}
$("remove-project").onclick = run(() => removeProject(state.root));
$("context-remove-project").onclick = run(() => removeProject(contextProject));
$("context-reveal-project").onclick = run(() => api("files/system", { root: contextProject, action: "reveal" }));
$("context-terminal-project").onclick = run(() => api("files/system", { root: contextProject, action: "terminal" }));
$("move-project").onclick = run(async () => {
  const roots = state.projects.map(p => p.root); const at = roots.indexOf(state.root);
  if (at <= 0) return;
  [roots[at - 1], roots[at]] = [roots[at], roots[at - 1]];
  await api("projects/order", { roots }); await refresh();
});
async function loadRound() {
  const current = ++generation;
  const scrollKey = state.data ? state.data.sessionId + ":" + state.data.id : "";
  if (scrollKey) positions.set(scrollKey, $("document").parentElement.scrollTop);
  renderer.destroy();
  state.data = null;
  $("changed").replaceChildren();
  $("file-count").textContent = "0";
  $("change-totals").replaceChildren(); $("changed-layout").hidden = true;
  if (state.mode === "turn") { $("content").replaceChildren(); if (!sourceOpen) contentHeader(); }
  $("reply-source").value = "";
  if (!state.session || !state.round) {
    if (state.mode === "turn") { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "This project has no round report yet. You can still browse files and history."; $("content").replaceChildren(empty); }
    const empty = document.createElement("span"); empty.className = "reply-empty"; empty.textContent = "No replies yet";
    $("document").replaceChildren(empty);
    updateReplyContext();
    return;
  }
  const data = await api(`round?session=${encodeURIComponent(state.session)}&id=${encodeURIComponent(state.round)}`);
  if (current !== generation) return;
  state.data = data;
  temporaryPreview = false;
  $("reply-source").value = data.reply;
  renderer.render(data.reply || data.replyError || "No final reply for this round");
  updateReplyContext();
  $("document").parentElement.scrollTop = positions.get(data.sessionId + ":" + data.id) || 0;
  const report = data.report;
  $("file-count").textContent = report?.files.length || 0;
  $("changed-layout").hidden = !report?.files.length;
  $("change-totals").append(...counts(report?.added, report?.deleted));
  renderChanged();
  if (state.mode === "turn") {
    if (report?.files.length) showDiff(report.files[0], true);
    else $("content").textContent = data.notice || (report?.incomplete ? "The report is incomplete" : report ? "No tracked files changed" : "This round was not captured");
  }
}
function renderChanged() {
  const list = $("changed"); list.replaceChildren();
  list.classList.toggle("tree-mode", changedTree);
  const directories = new Map([["", list]]);
  for (const file of state.data?.report?.files || []) {
    let parent = list;
    if (changedTree) {
      let prefix = "";
      for (const part of file.path.split("/").slice(0, -1)) {
        prefix += part + "/";
        if (!directories.has(prefix)) {
          const folder = document.createElement("details"); folder.className = "tree-dir"; folder.open = true;
          const title = document.createElement("summary");
          title.innerHTML = '<svg class="icon"><use href="#i-folder"/></svg>';
          const label = document.createElement("span"); label.textContent = part; title.append(label);
          const children = document.createElement("div"); folder.append(title, children); parent.append(folder); directories.set(prefix, children);
        }
        parent = directories.get(prefix);
      }
    }
    const row = fileButton(file.path, () => showDiff(file), file);
    parent.append(row);
  }
  selectFile(state.file);
}
$("changed-layout").onclick = () => {
  changedTree = !changedTree;
  $("changed-layout").textContent = changedTree ? "Flat" : "Tree";
  $("changed-layout").setAttribute("aria-pressed", String(changedTree));
  const label = changedTree ? "Show changed files as a flat list" : "Show changed files as a tree";
  $("changed-layout").setAttribute("aria-label", label);
  $("changed-layout").title = label;
  renderChanged();
};
$("open-scratch").onclick = () => {
  if (window.mygo) window.mygo.call("Desktop.OpenScratch");
  else window.open("/scratch", "review-scratch");
};
function showDiff(file, preserveSource = false) {
  if (!leaveFile()) return;
  if (!preserveSource) setSource(false);
  closeHistory();
  generation++;
  state.mode = "turn"; state.file = file.path;
  if (!sourceOpen) contentHeader(file.path, file);
  else { $("doc-toolbar").replaceChildren(); $("doc-toolbar").hidden = true; }
  selectFile(file.path);
  const root = document.createElement("div"); root.className = "diff-surface round-diff";
  $("content").replaceChildren(root);
  const toolbar = $("doc-toolbar");
  toolbar.hidden = sourceOpen;
  diff = mountDiff(root, file, path => openFile(path), { toolbar });
  $("content-footer-actions").replaceChildren(Object.assign(document.createElement("span"), { className: "hint", textContent: "j / k" }));
  if (state.data?.report) {
    const report = state.data.report;
    $("content-position").textContent = `${report.files.findIndex(f => f.path === file.path) + 1} / ${report.files.length} files`;
    const context = document.createElement("details");
    const summary = document.createElement("summary");
    const clock = value => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    summary.textContent = `Round request · ${clock(report.start)} – ${clock(report.end)}`;
    const body = document.createElement("div");
    const prompts = document.createElement("pre"); prompts.textContent = report.prompts.join("\n\n") || "User message not captured";
    const coverage = document.createElement("p"); coverage.className = "coverage";
    coverage.textContent = "Captures net edits from Edit / Write / apply_patch. Commands and external writes are outside the report.";
    context.className = "round-context"; context.append(summary, body); body.append(prompts, coverage); context.open = true;
    $("content").prepend(context);
  }
  if (state.data?.report?.incomplete || state.data?.outcome !== "completed") {
    const warning = document.createElement("p"); warning.className = "notice";
    warning.textContent = "This round was interrupted, failed, or incomplete. Only captured changes are shown.";
    root.prepend(warning);
  }
}
async function openFile(path, line = 1, offset = 0, initialView = defaultPreview() ? "preview" : "source") {
  if (!state.root || !leaveFile()) return;
  setSource(false);
  closeHistory();
  const root = state.root, current = ++generation;
  const image = isImagePath(path);
  const file = await api(`${image ? "image" : "file"}?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}&offset=${offset}`);
  if (current !== generation || root !== state.root) return;
  state.mode = "file"; currentFile = { ...file, path, root, line, view: initialView, image };
  state.file = path; contentHeader(path); selectFile(path);
  $("content-position").textContent = file.partial ? `Bytes ${file.offset} / ${file.size}` : "";
  const toolbar = $("doc-toolbar"); toolbar.hidden = false;
  if (image) {
    toolbar.append(button("Reload", () => openFile(currentFile.path)));
    $("content").replaceChildren(imagePreview(file.url, path));
    updateWatch();
    return;
  }
  const status = document.createElement("span"); status.className = "file-state";
  const edit = button("Edit (e)", () => editor?.enable());
  const save = button("Save ⌘S", saveFile);
  const reload = button("Reload", () => openFile(currentFile.path, line, offset, currentFile.view));
  toolbar.append(edit, save, reload, status);
  if (file.nextOffset !== null) toolbar.append(button("Next segment", () => openFile(path, 1, file.nextOffset)));
  if (file.offset) toolbar.append(button("Back to start", () => openFile(path)));
  const host = document.createElement("div"); host.className = "editor-host";
  const panes = document.createElement("div"); panes.className = "file-panes";
  panes.append(host);
  const holder = document.createElement("div"); holder.className = "file-view";
  holder.append(panes); $("content").replaceChildren(holder);
  const markdown = /\.(md|markdown|mdx)$/i.test(path) && !file.partial;
  let preview, refreshPreview;
  if (markdown) {
    preview = document.createElement("div"); preview.className = "reply-pane file-preview"; preview.dataset.paper = $("reply-pane").dataset.paper;
    const article = document.createElement("article"); article.className = "markdown-body"; preview.append(article); panes.append(preview);
    fileRenderer = createReplyRenderer(article, { summary: false, resolveImage: source => projectImage(api, currentFile.root, currentFile.path, source) });
    refreshPreview = () => fileRenderer?.render(editor.text);
    const views = document.createElement("nav"); views.className = "segmented file-views"; views.setAttribute("aria-label", "Markdown view");
    const setView = view => {
      currentFile.view = view;
      panes.dataset.view = view;
      host.hidden = view === "preview"; preview.hidden = view === "source";
      views.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
      if (view !== "source" && editor) refreshPreview();
    };
    for (const [view, label] of [["source", "Source"], ["split", "Split"], ["preview", "Preview"]]) {
      const control = button(label, () => setView(view)); control.dataset.view = view; views.append(control);
    }
    toolbar.prepend(views);
    setView(initialView);
    article.addEventListener("click", run(async event => {
      const anchor = event.target.closest("a");
      const href = anchor?.getAttribute("href");
      if (!href || /^(https?:|mailto:|#)/i.test(href) || anchor.matches(".footnote-ref a,.footnote-backref")) return;
      event.preventDefault(); await openFile(relativeFilePath(currentFile.path, href));
    }));
  }
  editor = createFileEditor(host, file, run(saveFile), () => {
    status.textContent = editor?.dirty ? "Unsaved" : editor?.editable ? "UTF-8 · manual save" : "UTF-8 · read-only";
    status.classList.toggle("dirty", !!editor?.dirty);
    save.disabled = !editor?.dirty; edit.disabled = !!file.partial || !!editor?.editable;
    clearTimeout(filePreviewTimer);
    if (refreshPreview) filePreviewTimer = setTimeout(refreshPreview, 150);
  }, run(async (images, insert) => {
    for (const image of images) {
      const data = await imageData(image);
    const result = await api("image", { root: currentFile.root, path: currentFile.path, type: image.type, data: data.slice(data.indexOf(",") + 1) });
      insert(`![Image](${result.source})\n`);
    }
  }));
  refreshPreview?.();
  status.textContent = editor.editable ? "UTF-8 · manual save" : "UTF-8 · read-only";
  save.disabled = true; edit.disabled = file.partial || editor.editable;
  editor.goToLine(line);
  updateWatch();
}
async function saveFile() {
  if (!editor?.dirty || !currentFile || savingFile) return;
  savingFile = true;
  const draft = editor.text, target = currentFile, activeEditor = editor;
  try {
    const result = await api("file", { root: target.root, path: target.path, content: draft, version: target.version }, "PUT");
    target.version = result.version;
    // A new edit during the request remains dirty rather than being marked saved.
    if (editor === activeEditor) editor.markSaved(draft);
    notice("Saved");
  } catch (e) {
    notice(e.message);
    if (e.message.includes("changed on disk") && confirm("The file changed on disk. Overwrite the current disk version? Cancel keeps the draft.")) {
      const fresh = await api(`file?root=${encodeURIComponent(target.root)}&path=${encodeURIComponent(target.path)}`);
      target.version = fresh.version; savingFile = false; await saveFile();
    }
  } finally { savingFile = false; await recheckFile(); }
}
const affectsCurrent = item => currentFile?.root === item.root && (currentFile.path === item.path || currentFile.path.startsWith(item.path + "/"));
const explorer = createFileExplorer({
  api, root: () => state.root, current: () => currentFile?.path || state.file,
  expanded, fileButton: (path, action) => {
    const row = fileButton(path, action);
    row.classList.toggle("changed", !!state.data?.report?.files.some(file => file.path === path));
    return row;
  },
  notice, onWatch: updateWatch,
  async open(path) {
    await openFile(path);
    if (currentFile?.path === path) setPane("content-pane", false);
  },
  showTree() { indexMode(); setPane("files-pane", false); },
  async openNew(path) {
    await openFile(path, 1, 0, "source");
    if (currentFile?.path === path) { setPane("content-pane", false); editor?.enable(); }
  },
  async beforeRemove(item) {
    if (!affectsCurrent(item)) return true;
    if (savingFile) { notice("Saving. Wait before moving this file to Trash."); return false; }
    if (!editor?.dirty) return true;
    if (window.mygo) {
      const choice = await window.mygo.call("Desktop.ConfirmClose", currentFile.path);
      if (choice === 2) return false;
      if (choice === 1) return true;
      await saveFile(); return !editor.dirty;
    }
    return confirm("This file has unsaved changes. Discard the draft and move it to Trash?");
  },
  async onMutation(result) {
    if (result.move && affectsCurrent(result.move.from)) {
      const { from, to } = result.move;
      currentFile.path = to.path + currentFile.path.slice(from.path.length);
      currentFile.root = to.root; state.file = currentFile.path;
      contentIdentity(currentFile.path);
      fileRenderer?.render(editor.text);
    }
    if (result.removed && affectsCurrent(result.removed)) {
      removedFile = { ...currentFile };
      editor?.destroy(); editor = undefined; currentFile = undefined;
      clearTimeout(filePreviewTimer);
      fileRenderer?.destroy(); fileRenderer = undefined;
      state.file = ""; contentHeader();
      const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "File removed. Use Undo to restore it.";
      $("content").replaceChildren(empty);
    }
    if (result.restored && !currentFile && removedFile?.root === state.root &&
      result.restored.root === removedFile.root && (removedFile.path === result.restored.path || removedFile.path.startsWith(result.restored.path + "/"))) {
      await openFile(removedFile.path, removedFile.line, 0, removedFile.view);
      removedFile = undefined;
    }
    selectFile(state.file);
  },
});
function loadTree() { return explorer.refresh(); }
function updateWatch() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const paths = new Set(expanded);
  if (currentFile) paths.add(currentFile.path.includes("/") ? currentFile.path.slice(0, currentFile.path.lastIndexOf("/")) : "");
  socket.send(JSON.stringify({ type: "watch", root: foreground ? state.root : null, paths: [...paths] }));
  const watching = !!(foreground && state.root);
  $("watch-state").classList.toggle("local", !watching);
  $("watch-text").textContent = watching ? "Watching files" : "Local files";
}
async function recheckFile() {
  if (explorer.busy || !foreground || !currentFile || currentFile.partial || savingFile || sourceOpen) return;
  const target = currentFile;
  if (target.image) {
    const image = await api("image?" + new URLSearchParams({ root: target.root, path: target.path }));
    if (currentFile === target) $("content").replaceChildren(imagePreview(image.url, target.path));
    return;
  }
  const fresh = await api(`file?root=${encodeURIComponent(target.root)}&path=${encodeURIComponent(target.path)}`);
  if (currentFile !== target || fresh.version === target.version) return;
  if (editor?.dirty) notice("The file changed on disk; the draft is kept and will need conflict handling on save");
  else await openFile(target.path, target.line, 0, target.view);
}
async function chooseRound(id) {
  if (!leaveFile()) { $("rounds").value = state.round; return; }
  closeHistory(); state.mode = "turn"; state.round = id; await loadRound(); await refresh();
}
$("sessions").onchange = run(async e => { if (!leaveFile()) { e.target.value = state.session; return; } setSource(false); closeHistory(); state.session = e.target.value; state.round = ""; state.mode = "turn"; await refresh(); });
$("rounds").onchange = run(e => chooseRound(e.target.value));
$("previous").onclick = run(() => { const rounds = session()?.rounds || []; return chooseRound(rounds[Math.max(0, rounds.findIndex(r => r.id === state.round) - 1)]?.id || ""); });
$("next").onclick = run(() => { const rounds = session()?.rounds || []; return chooseRound(rounds[Math.min(rounds.length - 1, rounds.findIndex(r => r.id === state.round) + 1)]?.id || ""); });
$("latest").onclick = run(() => chooseRound(session()?.rounds.at(-1)?.id || ""));
$("turn-tab").onclick = run(async () => { if (!leaveFile()) return; setSource(false); closeHistory(); state.mode = "turn"; await loadRound(); });
$("history-tab").onclick = run(async () => {
  if (!state.root || !leaveFile()) return;
  setSource(false);
  closeHistory(); generation++; state.mode = "history";
  contentHeader("Git history"); selectFile("");
  indexMode(true);
  const root = state.root;
  const dispose = await showGitHistory($("content"), { index: $("git-index"), root, api, onOpenCurrent: path => openFile(path), onTitle: (name, stats) => contentIdentity(name, stats), onError: e => notice(e.message) });
  if (state.root !== root || state.mode !== "history") dispose(); else disposeHistory = dispose;
});
function toggleSource() {
  setSource(!sourceOpen);
  if (!sourceOpen) run(recheckFile)();
}
$("show-source").onclick = toggleSource;
$("close-source").onclick = () => { setSource(false); run(recheckFile)(); };
$("reply-source").oninput = () => {
  temporaryPreview = true; $("latest").hidden = false; $("reading-state").textContent = "Temporary preview";
  clearTimeout(renderTimer); renderTimer = setTimeout(() => { renderer.render($("reply-source").value); updateReplyContext(); }, 200);
};
setupTheme($("reply-pane"), () => { renderer.render($("reply-source").value); updateReplyContext(); });
setupPreviewPreference();
const panes = ["projects-pane", "files-pane", "content-pane", "reply-pane"];
for (const pane of JSON.parse(localStorage.getItem("review-collapsed-panes") || "[]")) $(pane).classList.add("collapsed");
const paneNames = { "projects-pane": "projects pane", "files-pane": "files pane", "content-pane": "content pane", "reply-pane": "reply pane" };
const paneSide = { "projects-pane": "left", "files-pane": "left", "content-pane": "left", "reply-pane": "right" };
const MIN_WIDTH = { projects: 140, files: 180, content: 280, reply: 300 };
const DEFAULT_WIDTH = { projects: 210, files: 248, reply: 470 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const collapsed = id => $(id).classList.contains("collapsed");
function cssWidth(name, fallback) {
  const value = parseFloat(getComputedStyle($("console")).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
let projectsWidth = Number(localStorage.getItem("review-projects-width")) || cssWidth("--projects-width", DEFAULT_WIDTH.projects);
let filesWidth = Number(localStorage.getItem("review-files-width")) || cssWidth("--files-width", DEFAULT_WIDTH.files);
let replyWidth = Number(localStorage.getItem("review-reply-width")) || DEFAULT_WIDTH.reply;
const effective = { projects: projectsWidth, files: filesWidth, reply: replyWidth };
function paneIcon(pane, expanded) {
  const flip = (paneSide[pane] === "left") === !expanded;
  return '<svg class="icon' + (flip ? " flip" : "") + '"><use href="#i-panel-left"/></svg>';
}
function limits(edge) {
  const total = $("console").clientWidth;
  const contentMin = collapsed("content-pane") ? 40 : MIN_WIDTH.content;
  const replyMin = collapsed("reply-pane") ? 40 : collapsed("content-pane") ? 360 : effective.reply;
  if (edge === "projects") return { min: MIN_WIDTH.projects, max: total - effective.files - contentMin - replyMin };
  if (edge === "files") return { min: MIN_WIDTH.files, max: total - effective.projects - contentMin - replyMin };
  return { min: MIN_WIDTH.reply, max: total - effective.projects - effective.files - contentMin };
}
function layoutPanes() {
  const total = $("console").clientWidth;
  let p = collapsed("projects-pane") ? 40 : projectsWidth;
  let f = collapsed("files-pane") ? 40 : filesWidth;
  let r = collapsed("reply-pane") ? 40 : replyWidth;
  if (!collapsed("content-pane")) {
    if (!collapsed("reply-pane")) {
      const maxReply = total - p - f - MIN_WIDTH.content;
      if (r > maxReply) r = Math.max(MIN_WIDTH.reply, maxReply);
    }
    let overflow = p + f + (collapsed("reply-pane") ? 40 : r) + MIN_WIDTH.content - total;
    if (overflow > 0) {
      const filesMin = collapsed("files-pane") ? 40 : MIN_WIDTH.files;
      const reduce = Math.min(overflow, Math.max(0, f - filesMin));
      f -= reduce; overflow -= reduce;
    }
    if (overflow > 0) {
      const projectsMin = collapsed("projects-pane") ? 40 : MIN_WIDTH.projects;
      const reduce = Math.min(overflow, Math.max(0, p - projectsMin));
      p -= reduce;
    }
  }
  if (collapsed("content-pane") && collapsed("reply-pane") && !collapsed("files-pane")) f = total - p - 80;
  effective.projects = p; effective.files = f; effective.reply = r;
  const columns = [
    collapsed("projects-pane") ? "40px" : p + "px",
    collapsed("files-pane") ? "40px" : f + "px",
    collapsed("content-pane") ? "40px" : "minmax(" + MIN_WIDTH.content + "px,1fr)",
    collapsed("reply-pane") ? "40px" : collapsed("content-pane") ? "minmax(360px,1fr)" : r + "px",
  ];
  $("console").style.gridTemplateColumns = columns.join(" ");
  const projectHandle = document.querySelector('.resizer[data-edge="projects"]');
  const fileHandle = document.querySelector('.resizer[data-edge="files"]');
  const replyHandle = document.querySelector('.resizer[data-edge="reply"]');
  projectHandle.hidden = collapsed("projects-pane") || collapsed("files-pane");
  fileHandle.hidden = collapsed("files-pane") || collapsed("content-pane");
  replyHandle.hidden = collapsed("content-pane") || collapsed("reply-pane");
  const pLimits = limits("projects"), fLimits = limits("files"), rLimits = limits("reply");
  const aria = (handle, now, min, max) => {
    handle.setAttribute("aria-valuenow", String(Math.round(now)));
    handle.setAttribute("aria-valuemin", String(Math.round(min)));
    handle.setAttribute("aria-valuemax", String(Math.round(Math.max(min, max))));
  };
  aria(projectHandle, p, pLimits.min, pLimits.max);
  aria(fileHandle, f, fLimits.min, fLimits.max);
  aria(replyHandle, r, rLimits.min, rLimits.max);
  document.querySelectorAll("[data-collapse]").forEach(control => {
    const open = !collapsed(control.dataset.collapse);
    const label = (open ? "Collapse " : "Expand ") + paneNames[control.dataset.collapse];
    control.setAttribute("aria-controls", control.dataset.collapse);
    control.setAttribute("aria-expanded", String(open));
    control.setAttribute("aria-label", label);
    control.title = label;
    control.innerHTML = paneIcon(control.dataset.collapse, open);
  });
}
function setPane(id, isCollapsed) {
  $(id).classList.toggle("collapsed", isCollapsed);
  localStorage.setItem("review-collapsed-panes", JSON.stringify(panes.filter(collapsed)));
  layoutPanes();
}
document.querySelectorAll("[data-collapse]").forEach(b => { b.onclick = () => setPane(b.dataset.collapse, !collapsed(b.dataset.collapse)); });
function persistWidths() {
  localStorage.setItem("review-projects-width", String(Math.round(projectsWidth)));
  localStorage.setItem("review-files-width", String(Math.round(filesWidth)));
  localStorage.setItem("review-reply-width", String(Math.round(replyWidth)));
}
function setWidth(edge, value) {
  const limit = limits(edge);
  const next = clamp(value, limit.min, Math.max(limit.min, limit.max));
  if (edge === "projects") projectsWidth = next;
  else if (edge === "files") filesWidth = next;
  else replyWidth = next;
  layoutPanes();
}
document.querySelectorAll(".resizer").forEach(resizer => {
  const edge = resizer.dataset.edge;
  resizer.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("active"); document.body.classList.add("resizing");
  };
  resizer.onpointermove = event => {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    const rect = $("console").getBoundingClientRect();
    if (edge === "projects") setWidth(edge, event.clientX - rect.left);
    else if (edge === "files") setWidth(edge, event.clientX - $("files-pane").getBoundingClientRect().left);
    else setWidth(edge, rect.right - event.clientX);
  };
  resizer.onlostpointercapture = () => {
    resizer.classList.remove("active"); document.body.classList.remove("resizing"); persistWidths();
  };
  resizer.onpointerup = event => { persistWidths(); resizer.releasePointerCapture(event.pointerId); };
  resizer.ondblclick = () => {
    projectsWidth = DEFAULT_WIDTH.projects; filesWidth = DEFAULT_WIDTH.files; replyWidth = DEFAULT_WIDTH.reply;
    localStorage.removeItem("review-projects-width"); localStorage.removeItem("review-files-width"); localStorage.removeItem("review-reply-width");
    layoutPanes();
  };
  resizer.onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 20 : -20;
    if (edge === "reply") setWidth(edge, effective.reply - step);
    else setWidth(edge, effective[edge] + step);
    persistWidths();
  };
});
new ResizeObserver(layoutPanes).observe($("console"));
layoutPanes();
document.addEventListener("keydown", run(async e => {
  if (e.defaultPrevented) return;
  if (e.key === "Escape" && !$("project-context").hidden) {
    e.preventDefault(); $("project-context").hidden = true; return;
  }
  if (window.mygo && (e.metaKey || e.ctrlKey) && ["Enter", "s"].includes(e.key)) return;
  if (e.key === "Escape" && document.querySelector("details.menu[open]")) {
    e.preventDefault(); document.querySelectorAll("details.menu[open]").forEach(menu => menu.open = false); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && e.target.id !== "message-input") { e.preventDefault(); toggleSource(); return; }
  const typing = e.target.closest("input,textarea,select,[contenteditable=true]");
  if ((e.metaKey || e.ctrlKey) && e.key === "o" && !typing && !window.mygo) { e.preventDefault(); $("add-project").click(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    if (sourceOpen) { e.preventDefault(); notice("Reply source is a temporary preview; it is not written to disk or the session"); return; }
    if (editor && (!typing || e.target.closest(".editor-host"))) { e.preventDefault(); await saveFile(); }
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); $("previous").click(); return; }
  if (e.key === "ArrowRight") { e.preventDefault(); $("next").click(); return; }
  if (e.key === "e" && editor && !editor.editable) { e.preventDefault(); editor.enable(); }
  if (state.mode === "turn" && ["j","n","k","p"].includes(e.key)) { e.preventDefault(); diff?.nav(["j","n"].includes(e.key) ? 1 : -1); }
}));
document.addEventListener("paste", e => {
  if (e.defaultPrevented) return;
  if (e.target.closest("input,textarea,select,[contenteditable=true]")) return;
  const text = e.clipboardData?.getData("text/plain");
  if (!text) return;
  e.preventDefault(); temporaryPreview = true;
  $("latest").hidden = false; $("reading-state").textContent = "Temporary preview";
  $("reply-source").value = text; renderer.render(text); updateReplyContext();
  notice("Temporary preview, not part of this round; choose a round to return");
});
$("toggle-input").onclick = () => {
  $("message-panel").hidden = !$("message-panel").hidden;
  $("toggle-input").setAttribute("aria-expanded", String(!$("message-panel").hidden));
  if (!$("message-panel").hidden) $("message-input").focus();
};
$("message-input").oninput = () => drafts.set(inputSession, $("message-input").value);
async function sendMessage() {
  const target = session(), text = $("message-input").value;
  if (!target || sending || target.state !== "idle" || !text.trim()) return;
  sending = true; $("send").disabled = true; $("send-state").textContent = "Sending, waiting for pi…";
  try {
    await api("input", { sessionId: target.id, text });
    const currentDraft = target.id === inputSession ? $("message-input").value : drafts.get(target.id);
    if (currentDraft === text) {
      drafts.delete(target.id);
      if (inputSession === target.id) $("message-input").value = "";
    }
    notice("pi confirmed the message");
    await refresh();
    if (state.session === target.id && !editor?.dirty) await chooseRound(session()?.rounds.at(-1)?.id || "");
  } catch (e) { notice("Not confirmed; the draft is kept. Check the terminal before resending.\n" + e.message); }
  finally { sending = false; await refresh(); }
}
$("send").onclick = run(sendMessage);
$("message-input").onkeydown = run(async e => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault(); await sendMessage();
});
window.addEventListener("beforeunload", e => { if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("blur", () => { foreground = false; updateWatch(); });
window.addEventListener("focus", run(async () => { foreground = document.visibilityState === "visible"; refreshBranch(state.root); updateWatch(); await recheckFile(); await disposeHistory?.refresh?.(); }));
document.addEventListener("visibilitychange", run(async () => { foreground = document.visibilityState === "visible" && document.hasFocus(); updateWatch(); await recheckFile(); }));
$("document").addEventListener("click", run(async e => {
  const anchor = e.target.closest("a");
  if (!anchor || anchor.matches(".footnote-ref a,.footnote-backref")) return;
  const href = anchor.getAttribute("href") || "";
  if (/^(https?:|mailto:|#)/.test(href)) return;
  e.preventDefault();
  const match = decodeURIComponent(href.replace(/^file:\/\//, "")).match(/^(.*?)(?::(\d+)(?::\d+)?|#L(\d+))?$/);
  const path = match?.[1], line = Number(match?.[2] || match?.[3] || 1);
  await openFile(path, line);
  if ($("content-pane").classList.contains("collapsed")) { setPane("files-pane", false); setPane("content-pane", false); }
}));
async function reconnect() {
  if (stopped) return;
  try { await api("auth", {}); connectEvents(); }
  catch { reconnectTimer = setTimeout(reconnect, 2000); }
}
function connectEvents() {
  if (stopped) return;
  socket = new WebSocket(location.origin.replace("http", "ws") + "/events");
  socket.onopen = updateWatch;
  socket.onmessage = run(async e => {
    const event = JSON.parse(e.data);
    if (event.type === "focus") {
      await focusSession("#" + new URLSearchParams({ root: event.data.root, session: event.data.sessionId }));
      return;
    }
    if (event.type === "files") {
      refreshBranch(state.root); explorer.invalidateSearch();
      if (!explorer.busy) { await recheckFile(); await loadTree(); await disposeHistory?.refresh?.(); }
      return;
    }
    if (event.type === "watch-error") { notice(event.data); return; }
    await refresh();
  });
  socket.onclose = () => {
    if (stopped) return;
    notice("Connection lost; reconnecting. Drafts are kept");
    reconnectTimer = setTimeout(reconnect, 2000);
  };
}
window.addEventListener("pagehide", () => { stopped = true; clearTimeout(reconnectTimer); socket?.close(); });
window.addEventListener("review-console-replaced", () => {
  stopped = true; clearTimeout(reconnectTimer); socket?.close(); progressObserver.disconnect(); renderer.destroy(); editor?.destroy(); closeHistory();
});
window.reviewDesktop = {
  dirty: hasUnsavedChanges,
  async canClose() {
    if (savingFile) { notice("Saving. Wait for confirmation before closing."); return false; }
    if (editor?.dirty && window.mygo) {
      const choice = await window.mygo.call("Desktop.ConfirmClose", currentFile.path);
      if (choice === 2) return false;
      if (choice === 1) return true;
      await saveFile();
      return !editor.dirty;
    }
    return !hasUnsavedChanges() || confirm("Unsaved file changes will be discarded when this window closes. Continue?");
  },
  focus: focusSession,
  command(name) {
    if (name === "undo" && document.activeElement.closest("#tree") && !document.activeElement.matches("input")) run(() => explorer.undo())();
    else if (name === "undo" || name === "redo") editHistory(name);
    if (name === "quick-open") run(() => explorer.quickOpen())();
    if (name === "find" || name === "replace") {
      $("content").querySelector('[data-view="source"]')?.click();
      findInEditor($("content"));
    }
    if (name === "scratch") $("open-scratch").click();
    if (name === "save") {
      if (sourceOpen) notice("Reply source is a temporary preview; it is not written to disk or the session");
      else if (!document.activeElement.closest("input,textarea,select,[contenteditable=true]") || document.activeElement.closest(".editor-host")) run(saveFile)();
    }
    if (name === "source" && document.activeElement.id !== "message-input") toggleSource();
    if (name === "next") $("next").click();
    if (name === "previous") $("previous").click();
  },
};
run(async () => {
  await api("auth", {});
  await refresh(); await loadTree(); connectEvents();
})();
