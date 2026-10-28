import { mountDiff } from "./diff.js";
import { createReplyRenderer } from "./reply.js";

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
    const count = document.createElement("span"); count.textContent = selected?.rounds.at(-1)?.count ?? "—";
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
  const wasFollowing = !state.round || state.round === previousLatest;
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
  state.root = root; state.session = ""; state.round = ""; state.data = null; state.mode = "turn";
  await refresh();
}
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
  state.mode = "turn"; state.file = file.path;
  const root = document.createElement("div"); root.className = "diff-surface";
  $("content").replaceChildren(root);
  diff = mountDiff(root, file, path => openFile(path));
  if (state.data?.report?.incomplete || state.data?.outcome !== "completed") {
    const warning = document.createElement("p"); warning.className = "notice";
    warning.textContent = "本轮中断、失败或报告不完整；只显示已捕获部分"; root.prepend(warning);
  }
}
async function openFile(path) { notice("完整文件查看将在文件任务接入：" + path); }
async function chooseRound(id) { state.round = id; await loadRound(); await refresh(); }
$("sessions").onchange = run(async e => { state.session = e.target.value; state.round = ""; await refresh(); });
$("rounds").onchange = run(e => chooseRound(e.target.value));
$("previous").onclick = run(() => { const rounds = session()?.rounds || []; return chooseRound(rounds[Math.max(0, rounds.findIndex(r => r.id === state.round) - 1)]?.id || ""); });
$("next").onclick = run(() => { const rounds = session()?.rounds || []; return chooseRound(rounds[Math.min(rounds.length - 1, rounds.findIndex(r => r.id === state.round) + 1)]?.id || ""); });
$("latest").onclick = run(() => chooseRound(session()?.rounds.at(-1)?.id || ""));
$("turn-tab").onclick = run(async () => { state.mode = "turn"; await loadRound(); });
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
run(async () => {
  await api("auth", {});
  await refresh();
  const socket = new WebSocket(location.origin.replace("http", "ws") + "/events");
  socket.onmessage = run(async e => {
    const event = JSON.parse(e.data);
    if (event.type === "focus") { state.root = event.data.root; state.session = event.data.sessionId; state.round = ""; }
    await refresh();
  });
  socket.onclose = () => notice("连接已断开，刷新页面重新连接");
})();
