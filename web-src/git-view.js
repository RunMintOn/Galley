import { mountDiff } from "./diff.js";
import { createFileEditor } from "./editor.js";

export async function showGitHistory(container, { index, root, api, onOpenCurrent, onTitle, onError }) {
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
  const statsNode = (file, className) => {
    const span = document.createElement("span"); span.className = className;
    if (file.status === "Unavailable" || file.countable === false) { span.textContent = "Line counts unavailable"; return span; }
    const added = document.createElement("span"); added.className = "added"; added.textContent = "+" + file.added;
    const deleted = document.createElement("span"); deleted.className = "deleted"; deleted.textContent = "−" + file.deleted;
    span.append(added, deleted); return span;
  };
  const stats = file => file.status === "Unavailable" || file.countable === false ? "Line counts unavailable" : `+${file.added} −${file.deleted}`;
  const totals = files => {
    const available = files.filter(f => f.status !== "Unavailable" && f.countable !== false);
    return `+${available.reduce((n, f) => n + f.added, 0)} −${available.reduce((n, f) => n + f.deleted, 0)}` + (available.length !== files.length ? " · includes uncountable files" : "");
  };
  const diffView = (host, file, onOpen, hideHead = false) => {
    const bar = document.createElement("div"); bar.className = "doc-toolbar";
    const surface = document.createElement("div"); surface.className = "diff-surface";
    const holder = document.createElement("div"); holder.className = "diff-doc";
    holder.append(bar, surface); host.append(holder);
    return mountDiff(surface, file, onOpen, { toolbar: bar, hideHead });
  };
  const controls = document.createElement("div"); controls.className = "git-index-toolbar";
  const refs = document.createElement("select"); refs.setAttribute("aria-label", "History ref"); refs.append(new Option("HEAD", ""));
  const list = document.createElement("div"), workspace = document.createElement("div");
  controls.append(refs); index.append(controls, workspace, list);
  const fileView = async (path, hash) => {
    const request = ++serial;
    const file = await call("file", { path, hash }); if (!valid(request)) return;
    clear(); pane.replaceChildren(); onTitle?.(`${path} @ ${hash.slice(0, 7)}`);
    const bar = document.createElement("div"); bar.className = "doc-toolbar";
    bar.append(document.createTextNode(`${path} @ ${hash.slice(0, 7)} · read-only history`),
      button("Back to commit", () => details(selected, parent)), button("Open current file", () => onOpenCurrent(path)),
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
    clear(); pane.classList.remove("historical-file"); pane.replaceChildren(); onTitle?.(hash.slice(0, 7));
    list.querySelectorAll(".commit-row").forEach(b => b.setAttribute("aria-current", String(b.dataset.hash === hash)));
    const card = document.createElement("section"); card.className = "commit-card";
    const title = document.createElement("h2"); title.textContent = data.subject;
    const meta = document.createElement("p"); meta.textContent = `${data.author} · ${new Date(data.date).toLocaleString()} · ${hash.slice(0, 7)}`;
    const counts = document.createElement("p"); counts.className = "totals"; counts.textContent = totals(data.files) + (data.truncated ? " · first 500 files only, partial stats" : "");
    const base = document.createElement("p"); base.textContent = `Base: ${data.parent?.slice(0, 7) || "empty tree (root commit)"}`;
    card.append(title, meta, counts, base);
    if (data.parents.length > 1) {
      const select = document.createElement("select"); select.setAttribute("aria-label", "Compare against parent");
      data.parents.forEach((p, i) => select.append(new Option(`Parent ${i + 1}: ${p.slice(0, 7)}`, String(i))));
      select.value = String(parent); select.onchange = () => details(hash, Number(select.value)).catch(onError); card.append(select);
    }
    pane.append(card);
    let openBody, openToggle;
    for (const [i, file] of data.files.entries()) {
      const row = document.createElement("section"); row.className = "commit-file";
      const body = document.createElement("div"); body.hidden = true;
      const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "commit-file-row";
      toggle.innerHTML = '<svg class="icon commit-chev"><use href="#i-chevron"/></svg>';
      const name = document.createElement("span"); name.className = "commit-file-name"; name.textContent = file.path;
      toggle.append(name, statsNode(file, "commit-file-stats"));
      toggle.onclick = () => {
        const opening = body.hidden; clear();
        if (openBody) openBody.hidden = true;
        openToggle?.setAttribute("aria-expanded", "false"); openToggle = toggle;
        body.hidden = !opening; toggle.setAttribute("aria-expanded", String(opening));
        if (!opening) return;
        body.replaceChildren(); diffView(body, file, () => fileView(file.path, file.status === "Deleted" ? data.parent : hash).catch(onError), true); openBody = body;
      };
      toggle.setAttribute("aria-expanded", "false"); row.append(toggle, body); pane.append(row); if (!i) toggle.click();
    }
  }
  const chooseWorkspace = async (group, file) => {
    const request = ++serial;
    const data = await call("workspace-file", { group, path: file.path }); if (!valid(request)) return;
    list.querySelectorAll(".commit-row").forEach(b => b.setAttribute("aria-current", "false"));
    clear(); selected = ""; workspaceSelection = { group, path: file.path }; pane.classList.remove("historical-file"); pane.replaceChildren();
    onTitle?.(file.path);
    const label = document.createElement("span"); label.className = "toolbar-note";
    label.textContent = { staged: "Staged · HEAD → index", unstaged: "Unstaged · index → working tree", untracked: "Untracked · new file" }[group];
    const bar = document.createElement("div"); bar.className = "doc-toolbar";
    const surface = document.createElement("div"); surface.className = "diff-surface";
    const holder = document.createElement("div"); holder.className = "diff-doc"; holder.append(bar, surface); pane.append(holder);
    diff = mountDiff(surface, data, () => onOpenCurrent(file.path), { toolbar: bar });
    bar.querySelector(".diff-toolbar").prepend(label);
  };
  async function refreshWorkspace() {
    const request = ++listSerial;
    const data = await call("workspace"); if (stopped || !pane.isConnected || request !== listSerial) return;
    workspace.replaceChildren();
    const header = document.createElement("h3"); header.textContent = `Uncommitted · ${data.count} file${data.count === 1 ? "" : "s"}`;
    const total = document.createElement("p"); total.className = "workspace-total";
    total.textContent = `Group totals +${data.added} −${data.deleted}${data.unavailable ? " · includes uncountable files" : ""}${data.truncated ? " · partial results" : ""}`;
    workspace.append(header, total);
    for (const group of data.groups) {
      const section = document.createElement("details"); section.open = !!group.files.length;
      const summary = document.createElement("summary"); summary.textContent = `${{ staged: "Staged", unstaged: "Unstaged", untracked: "Untracked" }[group.id]} · ${group.files.length}  +${group.added} −${group.deleted}${group.unavailable ? " · includes uncountable" : ""}`;
      section.append(summary);
      for (const file of group.files) {
        const row = button("", () => chooseWorkspace(group.id, file), "workspace-file");
        const name = document.createElement("span"); name.className = "workspace-file-name"; name.textContent = file.path;
        row.append(name, statsNode(file, "workspace-file-stats"));
        section.append(row);
      }
      workspace.append(section);
    }
    if (!data.count) workspace.append(document.createTextNode("Working tree clean"));
    if (workspaceSelection) {
      const { group, path } = workspaceSelection;
      const file = data.groups.find(g => g.id === group)?.files.find(f => f.path === path);
      if (file) await chooseWorkspace(group, file);
      else { clear(); pane.textContent = "This working-tree change is gone"; }
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
      const group = day === today ? "Today" : day === yesterday ? "Yesterday" : "Earlier";
      if (group !== previous) { const h = document.createElement("h3"); h.className = "git-day"; h.textContent = group; list.append(h); previous = group; }
      const row = button("", () => details(commit.hash), "commit-row"); row.dataset.hash = commit.hash;
      row.setAttribute("aria-current", String(selected === commit.hash));
      row.title = `${commit.author} · ${new Date(commit.date).toLocaleString()}`;
      const subject = document.createElement("span"); subject.className = "commit-subject"; subject.textContent = commit.subject;
      const hash = document.createElement("span"); hash.className = "commit-hash"; hash.textContent = commit.hash.slice(0, 7);
      const date = document.createElement("span"); date.className = "commit-date"; date.textContent = new Date(commit.date).toLocaleTimeString();
      const stat = document.createElement("span"); stat.className = "commit-stats";
      const added = document.createElement("span"); added.className = "added"; added.textContent = "+" + commit.added;
      const deleted = document.createElement("span"); deleted.className = "deleted"; deleted.textContent = "−" + commit.deleted;
      stat.append(added, deleted);
      if (commit.unavailable) { const note = document.createElement("span"); note.textContent = " · uncountable"; row.title += " · includes uncountable files"; stat.append(note); }
      row.append(subject, hash, date, stat);
      list.append(row);
    }
    if (!data.commits.length) list.append(document.createTextNode("No commits"));
    if (skip) list.append(button("Previous page", () => { skip = Math.max(0, skip - 50); return loadList(); }));
    if (data.commits.length === 50) list.append(button("Next page", () => { skip += 50; return loadList(); }));
    if (!selected && !workspaceSelection && data.commits.length) await details(data.commits[0].hash);
  }
  refs.onchange = () => { ref = refs.value; skip = 0; selected = ""; workspaceSelection = undefined; loadList().catch(onError); };
  try {
    const data = await call("refs"); if (!stopped) data.refs.forEach(r => refs.append(new Option(r.name, r.hash)));
    await refreshWorkspace(); await loadList();
  } catch (e) { if (!stopped && pane.isConnected) { pane.textContent = "Git unavailable: " + e.message; index.append(document.createTextNode("Git unavailable")); } }
  const dispose = () => { stopped = true; serial++; listSerial++; logSerial++; clear(); };
  dispose.refresh = async () => { await refreshWorkspace(); await loadList(); };
  return dispose;
}
