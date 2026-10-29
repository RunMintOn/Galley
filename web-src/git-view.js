import { mountDiff } from "./diff.js";
import { createFileEditor } from "./editor.js";

export async function showGitHistory(container, { index, root, api, onOpenCurrent, onError }) {
  const pane = document.createElement("div"); pane.className = "git-view"; container.replaceChildren(pane);
  index.replaceChildren();
  let stopped = false, skip = 0, ref = "", selected = "", parent = 0, serial = 0, listSerial = 0, logSerial = 0;
  let workspaceSelection;
  let editor, diff;
  const call = (op, values = {}) => api("git/" + op + "?" + new URLSearchParams({ root, ...values }));
  const valid = request => !stopped && pane.isConnected && request === serial;
  const clear = () => { diff?.destroy(); editor?.destroy(); diff = editor = undefined; };
  const button = (label, action, className = "") => {
    const b = document.createElement("button"); b.textContent = label; b.className = className;
    b.onclick = () => Promise.resolve().then(action).catch(onError); return b;
  };
  const stats = file => file.status === "Unavailable" || file.countable === false ? "行数不可用" : `+${file.added} −${file.deleted}`;
  const totals = files => {
    const available = files.filter(f => f.status !== "Unavailable" && f.countable !== false);
    return `+${available.reduce((n, f) => n + f.added, 0)} −${available.reduce((n, f) => n + f.deleted, 0)}` + (available.length !== files.length ? " · 含不可计数文件" : "");
  };
  const controls = document.createElement("div"); controls.className = "git-index-toolbar";
  const refs = document.createElement("select"); refs.setAttribute("aria-label", "历史分支引用"); refs.append(new Option("HEAD", ""));
  const list = document.createElement("div"), workspace = document.createElement("div");
  controls.append(refs); index.append(controls, workspace, list);
  const fileView = async (path, hash) => {
    const request = ++serial;
    const file = await call("file", { path, hash }); if (!valid(request)) return;
    clear(); pane.replaceChildren();
    const bar = document.createElement("div"); bar.className = "file-toolbar";
    bar.append(document.createTextNode(`${path} @ ${hash.slice(0, 7)} · 历史只读`),
      button("返回提交", () => details(selected, parent)), button("打开当前文件", () => onOpenCurrent(path)),
      button("Blame", async () => {
        const data = await call("blame", { path, hash }); if (!valid(request)) return;
        editor?.destroy(); editor = undefined;
        const pre = document.createElement("pre"); pre.className = "blame"; pre.textContent = data.text; pane.replaceChildren(bar, pre);
      }));
    const host = document.createElement("div"); host.className = "editor-host"; pane.classList.add("historical-file"); pane.append(bar, host);
    editor = createFileEditor(host, { ...file, partial: true }, () => {}, () => {});
  };
  async function details(hash, parentIndex = 0) {
    selected = hash; parent = parentIndex; workspaceSelection = undefined;
    const request = ++serial;
    const data = await call("commit", { hash, parent: String(parent) }); if (!valid(request)) return;
    clear(); pane.classList.remove("historical-file"); pane.replaceChildren();
    list.querySelectorAll(".commit-row").forEach(b => b.setAttribute("aria-current", String(b.dataset.hash === hash)));
    const card = document.createElement("section"); card.className = "commit-card";
    const title = document.createElement("h2"); title.textContent = data.subject;
    const meta = document.createElement("p"); meta.textContent = `${data.author} · ${new Date(data.date).toLocaleString()} · ${hash.slice(0, 7)}`;
    const counts = document.createElement("p"); counts.className = "totals"; counts.textContent = totals(data.files) + (data.truncated ? " · 仅前 500 个文件，部分统计" : "");
    const base = document.createElement("p"); base.textContent = `比较基准：${data.parent?.slice(0, 7) || "空树（根提交）"}`;
    card.append(title, meta, counts, base);
    if (data.parents.length > 1) {
      const select = document.createElement("select"); select.setAttribute("aria-label", "比较父版本");
      data.parents.forEach((p, i) => select.append(new Option(`父版本 ${i + 1}: ${p.slice(0, 7)}`, String(i))));
      select.value = String(parent); select.onchange = () => details(hash, Number(select.value)).catch(onError); card.append(select);
    }
    pane.append(card);
    let openBody, openToggle;
    for (const [i, file] of data.files.entries()) {
      const row = document.createElement("section"); row.className = "commit-file";
      const body = document.createElement("div"); body.hidden = true;
      const toggle = button(`${file.path}  ${stats(file)}`, () => {
        const opening = body.hidden; clear();
        if (openBody) openBody.hidden = true;
        openToggle?.setAttribute("aria-expanded", "false"); openToggle = toggle;
        body.hidden = !opening; toggle.setAttribute("aria-expanded", String(opening));
        if (!opening) return;
        const surface = document.createElement("div"); surface.className = "diff-surface"; body.replaceChildren(surface); openBody = body;
        diff = mountDiff(surface, file, () => fileView(file.path, file.status === "Deleted" ? data.parent : hash).catch(onError));
      }, "commit-file-row");
      toggle.setAttribute("aria-expanded", "false"); row.append(toggle, body); pane.append(row); if (!i) toggle.click();
    }
  }
  const chooseWorkspace = async (group, file) => {
    const request = ++serial;
    const data = await call("workspace-file", { group, path: file.path }); if (!valid(request)) return;
    list.querySelectorAll(".commit-row").forEach(b => b.setAttribute("aria-current", "false"));
    clear(); selected = ""; workspaceSelection = { group, path: file.path }; pane.classList.remove("historical-file"); pane.replaceChildren();
    const label = document.createElement("div"); label.className = "file-toolbar";
    label.textContent = { staged: "已暂存 · HEAD → index", unstaged: "未暂存 · index → working tree", untracked: "未跟踪 · 新增" }[group];
    const surface = document.createElement("div"); surface.className = "diff-surface"; pane.append(label, surface);
    diff = mountDiff(surface, data, () => onOpenCurrent(file.path));
  };
  async function refreshWorkspace() {
    const request = ++listSerial;
    const data = await call("workspace"); if (stopped || !pane.isConnected || request !== listSerial) return;
    workspace.replaceChildren();
    const header = document.createElement("h3"); header.textContent = `未提交 · ${data.count} 文件`;
    const total = document.createElement("p"); total.className = "workspace-total";
    total.textContent = `分组差异合计 +${data.added} −${data.deleted}${data.unavailable ? " · 含不可计数文件" : ""}${data.truncated ? " · 部分结果" : ""}`;
    workspace.append(header, total);
    for (const group of data.groups) {
      const section = document.createElement("details"); section.open = !!group.files.length;
      const summary = document.createElement("summary"); summary.textContent = `${{staged:"已暂存",unstaged:"未暂存",untracked:"未跟踪"}[group.id]} · ${group.files.length}  +${group.added} −${group.deleted}${group.unavailable ? " · 含不可计数" : ""}`;
      section.append(summary);
      for (const file of group.files) section.append(button(`${file.path}  ${stats(file)}`, () => chooseWorkspace(group.id, file), "workspace-file"));
      workspace.append(section);
    }
    if (!data.count) workspace.append(document.createTextNode("工作区干净"));
    if (workspaceSelection) {
      const { group, path } = workspaceSelection;
      const file = data.groups.find(g => g.id === group)?.files.find(f => f.path === path);
      if (file) await chooseWorkspace(group, file);
      else { clear(); pane.textContent = "当前工作区差异已消失"; }
    }
  }
  async function loadList() {
    const request = ++logSerial;
    const data = await call("log", { skip: String(skip), ...(ref ? { hash: ref } : {}) }); if (stopped || !pane.isConnected || request !== logSerial) return;
    list.replaceChildren(); let previous = "";
    const yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const today = new Date().toLocaleDateString(), yesterday = yesterdayDate.toLocaleDateString();
    for (const commit of data.commits) {
      const day = new Date(commit.date).toLocaleDateString();
      const group = day === today ? "今天" : day === yesterday ? "昨天" : "更早";
      if (group !== previous) { const h = document.createElement("h3"); h.className = "git-day"; h.textContent = group; list.append(h); previous = group; }
      const row = button("", () => details(commit.hash), "commit-row"); row.dataset.hash = commit.hash;
      row.setAttribute("aria-current", String(selected === commit.hash));
      row.title = `${commit.author} · ${new Date(commit.date).toLocaleString()}`;
      for (const [className, text] of [["commit-subject", commit.subject], ["commit-hash", commit.hash.slice(0, 7)], ["commit-date", new Date(commit.date).toLocaleTimeString()], ["commit-stats", `+${commit.added} −${commit.deleted}${commit.unavailable ? " *" : ""}`]]) {
        const span = document.createElement("span"); span.className = className; span.textContent = text; row.append(span);
      }
      if (commit.unavailable) row.title += " · 含不可计数文件";
      list.append(row);
    }
    if (!data.commits.length) list.append(document.createTextNode("没有提交"));
    if (skip) list.append(button("上一页", () => { skip = Math.max(0, skip - 50); return loadList(); }));
    if (data.commits.length === 50) list.append(button("下一页", () => { skip += 50; return loadList(); }));
    if (!selected && !workspaceSelection && data.commits.length) await details(data.commits[0].hash);
  }
  refs.onchange = () => { ref = refs.value; skip = 0; selected = ""; workspaceSelection = undefined; loadList().catch(onError); };
  try {
    const data = await call("refs"); if (!stopped) data.refs.forEach(r => refs.append(new Option(r.name, r.hash)));
    await refreshWorkspace(); await loadList();
  } catch (e) { if (!stopped && pane.isConnected) { pane.textContent = "Git 不可用：" + e.message; index.append(document.createTextNode("Git 不可用")); } }
  const dispose = () => { stopped = true; serial++; listSerial++; logSerial++; clear(); };
  dispose.refresh = async () => { await refreshWorkspace(); await loadList(); };
  return dispose;
}
