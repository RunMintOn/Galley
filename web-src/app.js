import { mountDiff } from "./diff.js";
import { createReplyRenderer } from "./reply.js";
import { createFileEditor } from "./editor.js";

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
let socket;
let foreground = document.visibilityState === "visible" && document.hasFocus();
const expanded = new Set([""]);
function leaveFile() {
  if (editor?.dirty && !confirm("存在未保存修改。放弃这些修改并切换？")) return false;
  editor?.destroy(); editor = undefined; currentFile = undefined; return true;
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
function renderProjects() {
  $("project-count").textContent = state.projects.length;
  $("projects").replaceChildren(...state.projects.map(p => {
    const related = state.sessions.filter(s => s.root === p.root);
    const selected = related.find(s => s.id === state.session) || related.at(-1);
    const b = button("", () => chooseProject(p.root), "project");
    b.setAttribute("aria-current", String(p.root === state.root)); b.title = p.root;
    const dot = document.createElement("span"); dot.className = "dot" + (related.some(s => s.state === "working") ? " working" : ""); dot.textContent = "●";
    const label = document.createElement("span"); label.className = "project-name"; label.textContent = p.name;
    const path = document.createElement("small"); path.textContent = p.root; label.append(path);
    const count = document.createElement("span");
    count.textContent = (selected?.rounds.find(r => selected.id === state.session && r.id === state.round) || selected?.rounds.at(-1))?.count ?? "—";
    b.append(dot, label, count); return b;
  }));
}
async function refresh() {
  const previousLatest = session()?.rounds.at(-1)?.id;
  const data = await api("projects");
  state.projects = data.projects; state.sessions = data.sessions;
  if (!state.projects.some(p => p.root === state.root)) state.root = state.projects[0]?.root || "";
  if (!state.sessions.some(s => s.id === state.session && s.root === state.root)) state.session = state.sessions.filter(s => s.root === state.root).at(-1)?.id || "";
  const selected = session();
  const latest = selected?.rounds.at(-1)?.id || "";
  const wasFollowing = !editor && (!state.round || state.round === previousLatest);
  if (wasFollowing) state.round = latest;
  renderProjects();
  $("sessions").replaceChildren(...state.sessions.filter(s => s.root === state.root).map(s => option(s.id, s.title)));
  $("sessions").value = state.session;
  $("session-state").textContent = { offline: "离线", idle: "空闲", working: "工作中" }[selected?.state] || "无会话";
  $("rounds").replaceChildren(...(selected?.rounds || []).map((r, i) => option(r.id, `${i + 1} · ${new Date(r.end).toLocaleTimeString()} · ${r.outcome}`)));
  $("rounds").value = state.round;
  $("latest").textContent = state.round === latest ? "最新" : "新结果 · 回到最新";
  if (state.data?.id !== state.round || state.data?.sessionId !== state.session) await loadRound();
}
async function chooseProject(root) {
  if (!leaveFile()) return;
  state.root = root; state.session = ""; state.round = ""; state.data = null; state.mode = "turn";
  expanded.clear(); expanded.add("");
  await refresh(); await loadTree(); updateWatch();
}
export function savePosition() {
  if (state.data) positions.set(state.data.sessionId + ":" + state.data.id, $("document").parentElement.scrollTop);
}
export async function focusSession(hash) {
  if (!leaveFile()) return;
  const target = new URLSearchParams(hash.slice(1));
  state.session = target.get("session") || state.session;
  state.root = state.sessions.find(s => s.id === state.session)?.root || target.get("root") || state.root;
  state.round = ""; await refresh(); await loadTree(); updateWatch();
}
$("add-project").onclick = run(async () => {
  const root = prompt("本地项目的完整目录路径");
  if (!root) return;
  await api("projects", { root }); await refresh();
  const project = state.projects.find(p => p.root === root || p.root.endsWith(root));
  if (project) await chooseProject(project.root);
});
$("remove-project").onclick = run(async () => {
  if (!state.root || !confirm("从审查台移除此项目？不会删除磁盘文件。")) return;
  await api("projects", { root: state.root }, "DELETE"); await refresh();
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
  $("content").replaceChildren();
  $("reply-source").value = "";
  if (!state.session || !state.round) {
    $("content").textContent = "此项目尚无本轮报告；仍可浏览文件与历史。";
    $("document").textContent = "尚无回复";
    return;
  }
  const data = await api(`round?session=${encodeURIComponent(state.session)}&id=${encodeURIComponent(state.round)}`);
  if (current !== generation) return;
  state.data = data;
  $("reply-source").value = data.reply;
  renderer.render(data.reply || data.replyError || "本轮没有最终回复");
  $("document").parentElement.scrollTop = positions.get(data.sessionId + ":" + data.id) || 0;
  const report = data.report;
  $("file-count").textContent = report?.files.length || 0;
  $("changed").replaceChildren(...(report?.files || []).map(f => button(`${f.path}  +${f.added} −${f.deleted}`, () => showDiff(f), "file-button")));
  if (state.mode === "turn") {
    if (report?.files.length) showDiff(report.files[0]);
    else $("content").textContent = data.notice || (report?.incomplete ? "报告不完整" : report ? "已追踪文件无净改动" : "本轮未捕获");
  }
}
function showDiff(file) {
  if (!leaveFile()) return;
  generation++;
  state.mode = "turn"; state.file = file.path;
  const root = document.createElement("div"); root.className = "diff-surface";
  $("content").replaceChildren(root);
  diff = mountDiff(root, file, path => openFile(path));
  if (state.data?.report?.incomplete || state.data?.outcome !== "completed") {
    const warning = document.createElement("p"); warning.className = "notice";
    warning.textContent = "本轮中断、失败或报告不完整；只显示已捕获部分"; root.prepend(warning);
  }
}
async function openFile(path, line = 1, offset = 0) {
  if (!state.root || !leaveFile()) return;
  const root = state.root, current = ++generation;
  const file = await api(`file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}&offset=${offset}`);
  if (current !== generation || root !== state.root) return;
  state.mode = "file"; currentFile = { ...file, root, line };
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
  if (!editor?.dirty || !currentFile) return;
  const draft = editor.text, target = currentFile, activeEditor = editor;
  try {
    const result = await api("file", { root: target.root, path: target.path, content: draft, version: target.version }, "PUT");
    target.version = result.version;
    // A new edit during the request remains dirty rather than being marked saved.
    if (editor === activeEditor && editor.text === draft) editor.markSaved();
    notice("已保存");
  } catch (e) {
    notice(e.message);
    if (e.message.includes("磁盘文件已变化") && confirm("磁盘文件已被修改。是否明确覆盖当前磁盘版本？取消则保留草稿。")) {
      const fresh = await api(`file?root=${encodeURIComponent(target.root)}&path=${encodeURIComponent(target.path)}`);
      target.version = fresh.version; await saveFile();
    }
  }
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
          else { expanded.delete(file); children.replaceChildren(); }
          updateWatch();
        });
        parent.append(details);
      } else parent.append(button(item.name + (item.link ? " ↗" : ""), () => openFile(file), "file-button"));
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
}
async function recheckFile() {
  if (!foreground || !currentFile || currentFile.partial) return;
  const target = currentFile;
  const fresh = await api(`file?root=${encodeURIComponent(target.root)}&path=${encodeURIComponent(target.path)}`);
  if (currentFile !== target || fresh.version === target.version) return;
  if (editor?.dirty) notice("磁盘文件已变化；当前草稿保留，保存时需处理冲突");
  else await openFile(target.path, target.line);
}
async function chooseRound(id) { if (!leaveFile()) return; state.mode = "turn"; state.round = id; await loadRound(); await refresh(); }
$("sessions").onchange = run(async e => { if (!leaveFile()) { e.target.value = state.session; return; } state.session = e.target.value; state.round = ""; state.mode = "turn"; await refresh(); });
$("rounds").onchange = run(e => chooseRound(e.target.value));
$("previous").onclick = run(() => { const rounds = session()?.rounds || []; return chooseRound(rounds[Math.max(0, rounds.findIndex(r => r.id === state.round) - 1)]?.id || ""); });
$("next").onclick = run(() => { const rounds = session()?.rounds || []; return chooseRound(rounds[Math.min(rounds.length - 1, rounds.findIndex(r => r.id === state.round) + 1)]?.id || ""); });
$("latest").onclick = run(() => chooseRound(session()?.rounds.at(-1)?.id || ""));
$("turn-tab").onclick = run(async () => { if (!leaveFile()) return; state.mode = "turn"; await loadRound(); });
$("show-source").onclick = () => {
  $("reply-source").hidden = !$("reply-source").hidden;
  $("show-source").setAttribute("aria-expanded", String(!$("reply-source").hidden));
};
$("reply-source").oninput = () => { clearTimeout(renderTimer); renderTimer = setTimeout(() => renderer.render($("reply-source").value), 200); };
$("theme").onclick = () => {
  const dark = document.documentElement.classList.toggle("dark");
  $("reply-pane").classList.toggle("dark", dark);
  localStorage.setItem("review-theme", dark ? "dark" : "light");
  renderer.render($("reply-source").value);
};
if (localStorage.getItem("review-theme") === "light") { document.documentElement.classList.remove("dark"); $("reply-pane").classList.remove("dark"); }
document.querySelectorAll("[data-collapse]").forEach(b => b.onclick = () => {
  const pane = $(b.dataset.collapse); pane.classList.toggle("collapsed");
  const widths = ["projects-pane","files-pane","content-pane","reply-pane"].map((id,i) => $(id).classList.contains("collapsed") ? "40px" : ["176px","236px","minmax(260px,1fr)","minmax(300px,1fr)"][i]);
  $("console").style.gridTemplateColumns = widths.join(" ");
});
document.addEventListener("keydown", run(async e => {
  if (e.defaultPrevented) return;
  const typing = e.target.closest("input,textarea,select,[contenteditable=true]");
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { if (editor) { e.preventDefault(); await saveFile(); } return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "e") editor?.enable();
  if (state.mode === "turn" && ["j","n","k","p"].includes(e.key)) { e.preventDefault(); diff?.nav(["j","n"].includes(e.key) ? 1 : -1); }
}));
window.addEventListener("beforeunload", e => { if (editor?.dirty) { e.preventDefault(); e.returnValue = ""; } });
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
run(async () => {
  await api("auth", {});
  await refresh(); await loadTree();
  socket = new WebSocket(location.origin.replace("http", "ws") + "/events");
  socket.onopen = updateWatch;
  socket.onmessage = run(async e => {
    const event = JSON.parse(e.data);
    if (event.type === "focus") { if (!leaveFile()) return; state.root = event.data.root; state.session = event.data.sessionId; state.round = ""; }
    if (event.type === "files") { await recheckFile(); return; }
    if (event.type === "watch-error") { notice(event.data); return; }
    await refresh();
  });
  socket.onclose = () => notice("连接已断开，刷新页面重新连接");
})();
