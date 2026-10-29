import { mountDiff } from "./diff.js";
import { createReplyRenderer } from "./reply.js";
import { createFileEditor } from "./editor.js";
import { showGitHistory } from "./git-view.js";

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
let editor, currentFile;
let savingFile = false;
let sourceOpen = false;
let disposeHistory;
let socket;
let reconnectTimer, stopped = false, inputSession = "", sending = false, pasted = false;
const drafts = new Map();
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
  if (savingFile) { notice("正在保存，请等待确认后再切换"); return false; }
  if (editor?.dirty && !confirm("存在未保存修改。放弃这些修改并切换？")) return false;
  diff?.destroy(); diff = undefined;
  editor?.destroy(); editor = undefined; currentFile = undefined; return true;
}
function closeHistory() { disposeHistory?.(); disposeHistory = undefined; }
function setSource(open) {
  sourceOpen = open;
  if (open && $("content-pane").classList.contains("collapsed")) document.querySelector('[data-collapse="content-pane"]').click();
  for (const element of [$("content"), $("content-pane").querySelector(".content-header"), $("content-pane").querySelector("footer")]) element.hidden = open;
  for (const id of ["source-header", "source-view", "source-footer"]) $(id).hidden = !open;
  $("show-source").setAttribute("aria-expanded", String(open));
  $("show-source").textContent = open ? "Hide source" : "Show source";
}
export function notice(message) { $("notice").textContent = message; }
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
function fileButton(path, action, stats) {
  const b = button("", action, "file-button");
  b.dataset.path = path; b.title = path;
  const name = document.createElement("span"); name.className = "file-name";
  const basename = path.split("/").at(-1);
  const duplicate = stats && state.data?.report?.files.some(f => f.path !== path && f.path.split("/").at(-1) === basename);
  name.textContent = stats && !duplicate ? basename : path;
  b.append(name);
  if (stats) {
    const totals = document.createElement("span"); totals.className = "line-counts";
    totals.append(...counts(stats.added, stats.deleted)); b.append(totals);
  }
  return b;
}
function selectFile(path) {
  document.querySelectorAll("[data-path]").forEach(b => b.setAttribute("aria-current", String(b.dataset.path === path)));
}
function contentHeader(name = "", stats) {
  $("content-name").textContent = name.split("/").at(-1);
  $("content-name").title = name;
  $("content-counts").replaceChildren(...(stats ? counts(stats.added, stats.deleted) : []));
  $("content-actions").replaceChildren(); $("content-meta").replaceChildren();
  $("content-footer-actions").replaceChildren(); $("content-position").textContent = "";
  $("turn-tab").setAttribute("aria-pressed", String(state.mode === "turn"));
  $("history-tab").setAttribute("aria-pressed", String(state.mode === "history"));
}
function renderProjects() {
  $("project-count").textContent = state.projects.length;
  $("move-project").disabled = state.projects.findIndex(p => p.root === state.root) <= 0;
  $("remove-project").disabled = !state.root;
  $("projects").replaceChildren(...state.projects.map(p => {
    const related = state.sessions.filter(s => s.root === p.root);
    const selected = related.find(s => s.id === state.session) || related.at(-1);
    const b = button("", () => chooseProject(p.root), "project");
    b.setAttribute("aria-current", String(p.root === state.root)); b.title = p.root;
    const dot = document.createElement("span");
    dot.className = "dot" + (related.some(s => s.state === "working") ? " working" : related.some(s => s.state === "idle") ? " online" : "");
    dot.title = related.some(s => s.state === "working") ? "工作中" : related.some(s => s.state === "idle") ? "空闲" : "离线";
    const label = document.createElement("span"); label.className = "project-name"; label.textContent = p.name;
    const path = document.createElement("small"); path.textContent = p.root.replace(/^\/Users\/[^/]+/, "~"); label.append(path);
    const count = document.createElement("span"); count.className = "project-count";
    count.textContent = (selected?.rounds.find(r => selected.id === state.session && r.id === state.round) || selected?.rounds.at(-1))?.count ?? "—";
    b.append(dot, label, count); return b;
  }));
}
async function refresh() {
  const previousLatest = session()?.rounds.at(-1)?.id;
  const data = await api("projects");
  state.projects = data.projects;
  state.sessions = data.sessions.filter(s => state.projects.some(p => p.root === s.root));
  if (!state.projects.some(p => p.root === state.root)) state.root = state.sessions.find(s => s.id === state.session)?.root || state.projects[0]?.root || "";
  if (!state.sessions.some(s => s.id === state.session && s.root === state.root)) state.session = state.sessions.filter(s => s.root === state.root).at(-1)?.id || "";
  const selected = session();
  const latest = selected?.rounds.at(-1)?.id || "";
  const wasFollowing = !editor && !pasted && !sourceOpen && (!state.round || state.round === previousLatest);
  if (wasFollowing) state.round = latest;
  renderProjects();
  $("sessions").replaceChildren(...state.sessions.filter(s => s.root === state.root).map(s => option(s.id, s.title)));
  $("sessions").value = state.session;
  $("sessions").disabled = !state.session;
  $("session-state").textContent = { offline: "离线", idle: "空闲", working: "工作中" }[selected?.state] || "无会话";
  $("session-connection").dataset.connected = String(selected?.state === "idle" || selected?.state === "working");
  $("session-connection").dataset.state = selected?.state || "offline";
  $("toggle-input").disabled = !selected;
  if (inputSession !== state.session) {
    if (inputSession) drafts.set(inputSession, $("message-input").value);
    inputSession = state.session; $("message-input").value = drafts.get(inputSession) || "";
  }
  $("send").disabled = sending || selected?.state !== "idle";
  $("send-state").textContent = sending ? "发送中，等待 pi 确认…" : selected?.error || (selected?.state === "offline" ? "会话离线；可以写草稿" : "");
  const rounds = selected?.rounds || [];
  $("rounds").replaceChildren(...rounds.map((r, i) => { const o = option(r.id, `${i + 1} / ${rounds.length}`); o.title = `${new Date(r.end).toLocaleString()} · ${r.outcome}`; return o; }));
  if (!rounds.length) $("rounds").append(option("", "0 / 0"));
  $("rounds").value = state.round;
  const at = rounds.findIndex(r => r.id === state.round);
  $("previous").disabled = at <= 0; $("next").disabled = at < 0 || at === rounds.length - 1;
  $("rounds").disabled = !rounds.length;
  $("latest").hidden = state.round === latest && !pasted;
  $("reading-state").textContent = pasted ? "Temporary preview" : state.round === latest ? "Latest reply" : "Reading history";
  if (state.data?.id !== state.round || state.data?.sessionId !== state.session) await loadRound();
}
async function chooseProject(root) {
  if (!leaveFile()) return;
  setSource(false);
  closeHistory();
  state.root = root; state.session = ""; state.round = ""; state.data = null; state.mode = "turn";
  expanded.clear(); expanded.add("");
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
  const root = prompt("本地项目的完整目录路径");
  if (!root) return;
  const added = await api("projects", { root }); await refresh();
  await chooseProject(added.root);
});
$("add-project-top").onclick = () => $("add-project").click();
document.addEventListener("click", e => {
  const menu = $("project-menu");
  if (!menu.contains(e.target) || e.target.closest("button")) menu.open = false;
});
$("remove-project").onclick = run(async () => {
  if (!state.root || !confirm("从审查台移除此项目？不会删除磁盘文件。")) return;
  if (!leaveFile()) return;
  setSource(false);
  closeHistory();
  expanded.clear(); expanded.add("");
  await api("projects", { root: state.root }, "DELETE");
  state.round = ""; state.data = null; state.mode = "turn";
  await refresh(); await loadTree(); updateWatch();
});
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
  $("change-totals").replaceChildren(); $("rail-count").textContent = "";
  if (state.mode === "turn") { $("content").replaceChildren(); contentHeader(); }
  $("reply-source").value = "";
  if (!state.session || !state.round) {
    if (state.mode === "turn") { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "此项目尚无本轮报告；仍可浏览文件与历史。"; $("content").replaceChildren(empty); }
    $("document").textContent = "尚无回复";
    return;
  }
  const data = await api(`round?session=${encodeURIComponent(state.session)}&id=${encodeURIComponent(state.round)}`);
  if (current !== generation) return;
  state.data = data;
  pasted = false;
  $("show-source").textContent = sourceOpen ? "Hide source" : "Show source";
  $("reply-source").value = data.reply;
  renderer.render(data.reply || data.replyError || "本轮没有最终回复");
  $("document").parentElement.scrollTop = positions.get(data.sessionId + ":" + data.id) || 0;
  const report = data.report;
  $("file-count").textContent = report?.files.length || 0;
  $("rail-count").textContent = report?.files.length || "";
  $("change-totals").append(...counts(report?.added, report?.deleted));
  $("changed").replaceChildren(...(report?.files || []).map(f => fileButton(f.path, () => showDiff(f), f)));
  if (state.mode === "turn") {
    if (report?.files.length) showDiff(report.files[0], true);
    else $("content").textContent = data.notice || (report?.incomplete ? "报告不完整" : report ? "已追踪文件无净改动" : "本轮未捕获");
  }
}
function showDiff(file, preserveSource = false) {
  if (!leaveFile()) return;
  if (!preserveSource) setSource(false);
  closeHistory();
  generation++;
  state.mode = "turn"; state.file = file.path;
  contentHeader(file.path, file); selectFile(file.path);
  const root = document.createElement("div"); root.className = "diff-surface round-diff";
  $("content").replaceChildren(root);
  diff = mountDiff(root, file, path => openFile(path));
  $("content-actions").append(diff.controls);
  $("content-footer-actions").append(document.createTextNode("j / k"), diff.wrap);
  if (state.data?.report) {
    const report = state.data.report;
    $("content-position").textContent = `${report.files.findIndex(f => f.path === file.path) + 1} / ${report.files.length} files`;
    const context = document.createElement("details");
    const summary = document.createElement("summary"); summary.textContent = "ⓘ"; summary.setAttribute("aria-label", "本轮请求与捕获范围"); summary.title = "本轮请求与捕获范围";
    const body = document.createElement("div");
    const prompts = document.createElement("pre"); prompts.textContent = report.prompts.join("\n\n") || "用户消息未捕获";
    context.append(summary, body); body.append(prompts); context.className = "round-context"; $("content-meta").append(context);
    const coverage = document.createElement("p"); coverage.className = "coverage";
    coverage.textContent = "已捕获 Edit / Write / apply_patch 的净改动；命令和外部写入不在报告范围内。";
    body.append(coverage);
  }
  if (state.data?.report?.incomplete || state.data?.outcome !== "completed") {
    const warning = document.createElement("p"); warning.className = "notice";
    warning.textContent = "本轮中断、失败或报告不完整；只显示已捕获部分"; root.prepend(warning);
  }
}
async function openFile(path, line = 1, offset = 0) {
  if (!state.root || !leaveFile()) return;
  setSource(false);
  closeHistory();
  const root = state.root, current = ++generation;
  const file = await api(`file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}&offset=${offset}`);
  if (current !== generation || root !== state.root) return;
  state.mode = "file"; currentFile = { ...file, root, line };
  state.file = path; contentHeader(path); selectFile(path);
  $("content-position").textContent = file.partial ? `字节 ${file.offset} / ${file.size}` : "UTF-8 · 手动保存";
  const holder = document.createElement("div"); holder.className = "file-view";
  const title = document.createElement("div"); title.className = "content-title"; title.textContent = path + (file.partial ? ` · 分段只读 · 字节 ${file.offset} / ${file.size}` : "");
  const toolbar = document.createElement("div"); toolbar.className = "file-toolbar";
  const status = document.createElement("span"); status.className = "file-state";
  const edit = button("编辑 (e)", () => editor?.enable());
  const save = button("保存 ⌘S", saveFile);
  const reload = button("重新载入", () => openFile(path, line, offset));
  toolbar.append(edit, save, reload, status);
  if (file.nextOffset !== null) toolbar.append(button("下一段", () => openFile(path, 1, file.nextOffset)));
  if (file.offset) toolbar.append(button("回到文件开头", () => openFile(path)));
  const host = document.createElement("div"); host.className = "editor-host";
  holder.append(title, toolbar, host); $("content").replaceChildren(holder);
  editor = createFileEditor(host, file, run(saveFile), () => {
    status.textContent = editor?.dirty ? "未保存" : editor?.editable ? "可编辑 · 手动保存" : "只读";
    status.classList.toggle("dirty", !!editor?.dirty);
    save.disabled = !editor?.dirty; edit.disabled = !!file.partial || !!editor?.editable;
  });
  status.textContent = editor.editable ? "可编辑 · 手动保存" : "只读";
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
    notice("已保存");
  } catch (e) {
    notice(e.message);
    if (e.message.includes("磁盘文件已变化") && confirm("磁盘文件已被修改。是否明确覆盖当前磁盘版本？取消则保留草稿。")) {
      const fresh = await api(`file?root=${encodeURIComponent(target.root)}&path=${encodeURIComponent(target.path)}`);
      target.version = fresh.version; savingFile = false; await saveFile();
    }
  } finally { savingFile = false; await recheckFile(); }
}
async function loadTree() {
  const root = state.root;
  $("tree").replaceChildren();
  if (!root) return;
  const load = async (path, parent) => {
    const data = await api(`tree?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`);
    if (root !== state.root) return;
    parent.replaceChildren();
    for (const item of data.entries) {
      const file = path ? path + "/" + item.name : item.name;
      if (item.directory) {
        const details = document.createElement("details"); details.className = "tree-dir";
        const summary = document.createElement("summary"); summary.textContent = item.name + "/";
        const children = document.createElement("div"); details.append(summary, children);
        details.ontoggle = run(async () => {
          if (details.open) { expanded.add(file); await load(file, children); }
          else {
            for (const entry of expanded) if (entry === file || entry.startsWith(file + "/")) expanded.delete(entry);
            children.replaceChildren();
          }
          updateWatch();
        });
        details.open = expanded.has(file);
        parent.append(details);
      } else {
        const b = fileButton(file, () => openFile(file));
        b.querySelector(".file-name").textContent = item.name + (item.link ? " ↗" : "");
        b.classList.toggle("changed", !!state.data?.report?.files.some(f => f.path === file));
        b.setAttribute("aria-current", String(state.file === file));
        parent.append(b);
      }
    }
    if (data.truncated) { const warning = document.createElement("p"); warning.textContent = "目录条目过多，仅显示前 2000 项"; parent.append(warning); }
  };
  await load("", $("tree"));
}
function updateWatch() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const paths = new Set(expanded);
  if (currentFile) paths.add(currentFile.path.includes("/") ? currentFile.path.slice(0, currentFile.path.lastIndexOf("/")) : "");
  socket.send(JSON.stringify({ type: "watch", root: foreground ? state.root : null, paths: [...paths] }));
  $("watch-state").textContent = foreground && state.root ? "watching · 本地文件" : "本地文件";
}
async function recheckFile() {
  if (!foreground || !currentFile || currentFile.partial || savingFile || sourceOpen) return;
  const target = currentFile;
  const fresh = await api(`file?root=${encodeURIComponent(target.root)}&path=${encodeURIComponent(target.path)}`);
  if (currentFile !== target || fresh.version === target.version) return;
  if (editor?.dirty) notice("磁盘文件已变化；当前草稿保留，保存时需处理冲突");
  else await openFile(target.path, target.line);
}
async function chooseRound(id) {
  if (!leaveFile()) { $("rounds").value = state.round; return; }
  closeHistory(); state.mode = "turn"; state.round = id; await loadRound(); await refresh();
}
$("sessions").onchange = run(async e => { if (!leaveFile()) { e.target.value = state.session; return; } state.session = e.target.value; state.round = ""; state.mode = "turn"; await refresh(); });
$("rounds").onchange = run(e => chooseRound(e.target.value));
$("previous").onclick = run(() => { const rounds = session()?.rounds || []; return chooseRound(rounds[Math.max(0, rounds.findIndex(r => r.id === state.round) - 1)]?.id || ""); });
$("next").onclick = run(() => { const rounds = session()?.rounds || []; return chooseRound(rounds[Math.min(rounds.length - 1, rounds.findIndex(r => r.id === state.round) + 1)]?.id || ""); });
$("latest").onclick = run(() => chooseRound(session()?.rounds.at(-1)?.id || ""));
$("turn-tab").onclick = run(async () => { if (!leaveFile()) return; setSource(false); closeHistory(); state.mode = "turn"; await loadRound(); });
$("history-tab").onclick = run(async () => {
  if (!state.root || !leaveFile()) return;
  setSource(false);
  closeHistory(); generation++; state.mode = "history";
  contentHeader("Git 历史"); selectFile("");
  disposeHistory = await showGitHistory($("content"), { root: state.root, api, onOpenCurrent: path => openFile(path), onError: e => notice(e.message) });
});
function toggleSource() {
  setSource(!sourceOpen);
  if (!sourceOpen) run(recheckFile)();
}
$("show-source").onclick = toggleSource;
$("close-source").onclick = () => { setSource(false); run(recheckFile)(); };
$("reply-source").oninput = () => {
  pasted = true; $("latest").hidden = false; $("reading-state").textContent = "Temporary preview";
  clearTimeout(renderTimer); renderTimer = setTimeout(() => renderer.render($("reply-source").value), 200);
};
function themeControls() {
  const dark = document.documentElement.classList.contains("dark");
  $("theme").innerHTML = dark
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/></svg>';
  const papers = dark ? [["charcoal","Charcoal"],["slate","Slate"],["warm","Warm grey"]] : [["ivory","Ivory"],["white","White"],["warm","Warm grey"]];
  $("paper").replaceChildren(...papers.map(([value, label]) => option(value, label)));
  const saved = localStorage.getItem(dark ? "review-dark-paper" : "review-light-paper");
  $("paper").value = papers.some(([value]) => value === saved) ? saved : papers[0][0];
  $("reply-pane").dataset.paper = $("paper").value;
}
$("theme").onclick = () => {
  const dark = document.documentElement.classList.toggle("dark");
  $("reply-pane").classList.toggle("dark", dark);
  localStorage.setItem("review-theme", dark ? "dark" : "light");
  themeControls();
  renderer.render($("reply-source").value);
};
if (localStorage.getItem("review-theme") === "light") { document.documentElement.classList.remove("dark"); $("reply-pane").classList.remove("dark"); }
themeControls();
$("paper").onchange = () => {
  $("reply-pane").dataset.paper = $("paper").value;
  localStorage.setItem(document.documentElement.classList.contains("dark") ? "review-dark-paper" : "review-light-paper", $("paper").value);
};
document.querySelectorAll("[data-collapse]").forEach(b => b.onclick = () => {
  const pane = $(b.dataset.collapse); const collapsed = pane.classList.toggle("collapsed");
  if (pane.id === "content-pane") $("files-pane").classList.toggle("collapsed", collapsed);
  if (pane.id === "files-pane" && !collapsed) $("content-pane").classList.remove("collapsed");
  const widths = ["projects-pane","files-pane","content-pane","reply-pane"].map((id,i) => $(id).classList.contains("collapsed") ? (i === 2 ? "0px" : "40px") : ["var(--projects-width,176px)","var(--files-width,236px)","minmax(260px,500fr)","minmax(300px,528fr)"][i]);
  $("console").style.gridTemplateColumns = widths.join(" ");
});
document.addEventListener("keydown", run(async e => {
  if (e.defaultPrevented) return;
  if (e.key === "Escape" && $("project-menu").open) { e.preventDefault(); $("project-menu").open = false; return; }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && e.target.id !== "message-input") { e.preventDefault(); toggleSource(); return; }
  const typing = e.target.closest("input,textarea,select,[contenteditable=true]");
  if ((e.metaKey || e.ctrlKey) && e.key === "o" && !typing) { e.preventDefault(); $("add-project").click(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    if (sourceOpen) { e.preventDefault(); notice("回复原文仅临时预览，不写入文件或会话"); return; }
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
  if (e.target.closest("input,textarea,select,[contenteditable=true]")) return;
  const text = e.clipboardData?.getData("text/plain");
  if (!text) return;
  e.preventDefault(); pasted = true;
  $("latest").hidden = false; $("reading-state").textContent = "Temporary preview";
  $("reply-source").value = text; renderer.render(text);
  notice("临时预览，不属于当前轮次；选择轮次可返回");
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
  sending = true; $("send").disabled = true; $("send-state").textContent = "发送中，等待 pi 确认…";
  try {
    await api("input", { sessionId: target.id, text });
    const currentDraft = target.id === inputSession ? $("message-input").value : drafts.get(target.id);
    if (currentDraft === text) {
      drafts.delete(target.id);
      if (inputSession === target.id) $("message-input").value = "";
    }
    notice("pi 已确认收到消息");
    await refresh();
    if (state.session === target.id && !editor?.dirty) await chooseRound(session()?.rounds.at(-1)?.id || "");
  } catch (e) { notice("未确认发送；草稿保留。检查终端后再决定是否重发。\n" + e.message); }
  finally { sending = false; await refresh(); }
}
$("send").onclick = run(sendMessage);
$("message-input").onkeydown = run(async e => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault(); await sendMessage();
});
window.addEventListener("beforeunload", e => { if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("blur", () => { foreground = false; updateWatch(); });
window.addEventListener("focus", run(async () => { foreground = document.visibilityState === "visible"; updateWatch(); await recheckFile(); }));
document.addEventListener("visibilitychange", run(async () => { foreground = document.visibilityState === "visible" && document.hasFocus(); updateWatch(); await recheckFile(); }));
$("document").addEventListener("click", run(async e => {
  const anchor = e.target.closest("a");
  if (!anchor || anchor.matches(".footnote-ref a,.footnote-backref")) return;
  const href = anchor.getAttribute("href") || "";
  if (/^(https?:|mailto:|#)/.test(href)) return;
  e.preventDefault();
  const match = decodeURIComponent(href.replace(/^file:\/\//, "")).match(/^(.*?)(?::(\d+)(?::\d+)?|#L(\d+))?$/);
  const path = match?.[1], line = Number(match?.[2] || match?.[3] || 1);
  const file = state.data?.report?.files.find(f => f.path === path);
  if (file) {
    showDiff(file); diff?.goToLine(line);
    if ($("content-pane").classList.contains("collapsed")) document.querySelector('[data-collapse="content-pane"]').click();
  }
  else await openFile(path, line);
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
    if (event.type === "files") { await recheckFile(); await loadTree(); return; }
    if (event.type === "watch-error") { notice(event.data); return; }
    await refresh();
  });
  socket.onclose = () => {
    if (stopped) return;
    notice("连接已断开，正在重连；草稿保留");
    reconnectTimer = setTimeout(reconnect, 2000);
  };
}
window.addEventListener("pagehide", () => { stopped = true; clearTimeout(reconnectTimer); socket?.close(); });
window.addEventListener("review-console-replaced", () => {
  stopped = true; clearTimeout(reconnectTimer); socket?.close(); progressObserver.disconnect(); renderer.destroy(); editor?.destroy(); closeHistory();
});
run(async () => {
  await api("auth", {});
  await refresh(); await loadTree(); connectEvents();
})();
