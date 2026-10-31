import { mountDiff } from "./diff.js";
import { createFileEditor } from "./editor.js";
import { isImagePath, imagePreview } from "./images.js";

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "always" });
const isMarkdown = path => /\.(md|markdown|mdx)$/i.test(path);
function ago(date) {
  const seconds = (new Date(date).getTime() - Date.now()) / 1000;
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]]) {
    if (Math.abs(seconds) >= size || unit === "second") return relativeTime.format(Math.round(seconds / size), unit);
  }
}

export async function showGitHistory(container, { index, root, api, onOpenCurrent, onTitle, onError }) {
  const pane = document.createElement("div"); pane.className = "git-view"; container.replaceChildren(pane);
  index.replaceChildren();
  let stopped = false, skip = 0, ref = "", selected = "", parent = 0, serial = 0, listSerial = 0, logSerial = 0;
  let workspaceSelection;
  let workspaceOverview = false;
  let editor, diff;
  const commitDiffs = new Map();
  let repository = true;
  let workspaceTree = true;
  const closedFolders = new Set();
  const call = (op, values = {}) => api("git/" + op + "?" + new URLSearchParams({ root, ...values }));
  const workspaceFile = (group, path) => isImagePath(path)
    ? group === "staged" ? call("image", { group, path }) : api("image?" + new URLSearchParams({ root, path }))
    : call("workspace-file", { group, path });
  const valid = request => !stopped && pane.isConnected && request === serial;
  const clear = () => {
    diff?.destroy(); editor?.destroy(); diff = editor = undefined;
    for (const view of commitDiffs.values()) view.destroy();
    commitDiffs.clear();
  };
  const button = (label, action, className = "") => {
    const b = document.createElement("button"); b.textContent = label; b.className = className;
    b.onclick = () => Promise.resolve().then(action).catch(onError); return b;
  };
  const statsNode = (file, className) => {
    const span = document.createElement("span"); span.className = className;
    if (file.status === "Unavailable" || file.countable === false) {
      span.textContent = isImagePath(file.path) ? "Image" : file.notice?.includes("Binary") ? "Binary" : "—";
      span.title = file.notice || "Text line counts are not available";
      return span;
    }
    const added = document.createElement("span"); added.className = "added"; added.textContent = "+" + file.added;
    const deleted = document.createElement("span"); deleted.className = "deleted"; deleted.textContent = "−" + file.deleted;
    span.append(added, deleted); return span;
  };
  const stats = file => file.status === "Unavailable" || file.countable === false ? "—" : `+${file.added} −${file.deleted}`;
  const totals = files => {
    const available = files.filter(f => f.status !== "Unavailable" && f.countable !== false);
    return `+${available.reduce((n, f) => n + f.added, 0)} −${available.reduce((n, f) => n + f.deleted, 0)}`;
  };
  const diffView = (host, file, onOpen, hideHead = false) => {
    const bar = document.createElement("div"); bar.className = "doc-toolbar";
    const surface = document.createElement("div"); surface.className = "diff-surface";
    const holder = document.createElement("div"); holder.className = "diff-doc";
    holder.append(bar, surface); host.append(holder);
    return mountDiff(surface, file, onOpen, { toolbar: bar, hideHead });
  };
  function appendFiles(files, renderBody) {
    for (const file of [...files].sort((a, b) => Number(isMarkdown(b.path)) - Number(isMarkdown(a.path)))) {
      const row = document.createElement("section"); row.className = "commit-file";
      const body = document.createElement("div"); body.hidden = true;
      const toggle = button("", async () => {
        const opening = body.hidden;
        commitDiffs.get(toggle)?.destroy(); commitDiffs.delete(toggle);
        body.hidden = !opening; toggle.setAttribute("aria-expanded", String(opening));
        if (!opening) return;
        body.replaceChildren(); await renderBody(body, file, toggle);
      }, "commit-file-row");
      toggle.dataset.historyPath = file.path;
      toggle.innerHTML = '<svg class="icon commit-chev"><use href="#i-chevron"/></svg>';
      const name = document.createElement("span"); name.className = "commit-file-name"; name.textContent = file.path;
      toggle.append(name);
      if (file.group) {
        const group = document.createElement("span"); group.className = "toolbar-note";
        group.textContent = { staged: "Staged", unstaged: "Unstaged", untracked: "Untracked" }[file.group]; toggle.append(group);
      }
      toggle.append(statsNode(file, "commit-file-stats"));
      toggle.setAttribute("aria-expanded", "false"); row.append(toggle, body); pane.append(row);
      if (isMarkdown(file.path)) toggle.click();
    }
  }
  const controls = document.createElement("div"); controls.className = "git-index-toolbar";
  const refs = document.createElement("details"); refs.className = "menu git-ref-picker";
  const refSummary = document.createElement("summary"); refSummary.setAttribute("aria-label", "History ref");
  const refLabel = document.createElement("span"); refLabel.className = "git-ref-label"; refLabel.textContent = "HEAD";
  refSummary.innerHTML = '<svg class="icon"><use href="#i-chevron-down"/></svg>'; refSummary.prepend(refLabel);
  const refOptions = document.createElement("div"); refOptions.className = "menu-items";
  const addRef = (label, value) => {
    const option = button(label, () => {
      ref = value; skip = 0; selected = ""; workspaceSelection = undefined; workspaceOverview = false;
      refLabel.textContent = label; refLabel.title = label; refs.open = false;
      for (const item of refOptions.children) item.setAttribute("aria-current", String(item === option));
      return loadList();
    });
    option.setAttribute("aria-current", String(value === ref));
    refOptions.append(option);
  };
  addRef("HEAD", "");
  refs.append(refSummary, refOptions);
  const closeRefs = event => { if (!refs.contains(event.target)) refs.open = false; };
  document.addEventListener("click", closeRefs);
  refs.addEventListener("keydown", event => {
    if (event.key === "Escape") { refs.open = false; refSummary.focus(); event.preventDefault(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); refs.open = true;
      const options = [...refOptions.children], current = options.indexOf(document.activeElement);
      options[(current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
    }
  });
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
    selected = hash; parent = parentIndex; workspaceSelection = undefined; workspaceOverview = false;
    const request = ++serial;
    const data = await call("commit", { hash, parent: String(parent) }); if (!valid(request)) return;
    clear(); pane.classList.remove("historical-file"); pane.replaceChildren(); onTitle?.(hash.slice(0, 7));
    list.querySelectorAll(".commit-row").forEach(b => b.setAttribute("aria-current", String(b.dataset.hash === hash)));
    const card = document.createElement("section"); card.className = "commit-card";
    const title = document.createElement("h2"); title.textContent = data.subject;
    const meta = document.createElement("p"); meta.textContent = `${data.author} · ${new Date(data.date).toLocaleString()} · ${hash.slice(0, 7)}`;
    const counts = document.createElement("p"); counts.className = "totals"; counts.textContent = totals(data.files) + (data.truncated ? " · first 500 files only, partial stats" : "");
    if (data.files.some(file => file.status === "Unavailable" || file.countable === false)) counts.title = "Line counts exclude files without text statistics";
    const base = document.createElement("p"); base.textContent = `Base: ${data.parent?.slice(0, 7) || "empty tree (root commit)"}`;
    card.append(title, meta, counts, base);
    if (data.parents.length > 1) {
      const select = document.createElement("select"); select.setAttribute("aria-label", "Compare against parent");
      data.parents.forEach((p, i) => select.append(new Option(`Parent ${i + 1}: ${p.slice(0, 7)}`, String(i))));
      select.value = String(parent); select.onchange = () => details(hash, Number(select.value)).catch(onError); card.append(select);
    }
    pane.append(card);
    appendFiles(data.files, async (body, file, toggle) => {
      if (isImagePath(file.path)) {
        const image = await call("image", { path: file.path, hash: file.status === "Deleted" ? data.parent : hash });
        if (valid(request) && !body.hidden) body.replaceChildren(imagePreview(image.url, file.path));
      } else commitDiffs.set(toggle, diffView(body, file, () => fileView(file.path, file.status === "Deleted" ? data.parent : hash).catch(onError), true));
    });
  }
  const chooseWorkspace = async (group, file) => {
    const request = ++serial;
    const image = isImagePath(file.path);
    const data = await workspaceFile(group, file.path);
    if (!valid(request)) return;
    list.querySelectorAll(".commit-row").forEach(b => b.setAttribute("aria-current", "false"));
    clear(); selected = ""; workspaceSelection = { group, path: file.path }; workspaceOverview = false; pane.classList.remove("historical-file"); pane.replaceChildren();
    onTitle?.(file.path);
    const label = document.createElement("span"); label.className = "toolbar-note";
    label.textContent = { staged: "Staged · HEAD → index", unstaged: "Unstaged · index → working tree", untracked: "Untracked · new file" }[group];
    const bar = document.createElement("div"); bar.className = "doc-toolbar";
    if (image) {
      bar.append(label); pane.append(bar, imagePreview(data.url, file.path)); return;
    }
    const surface = document.createElement("div"); surface.className = "diff-surface";
    const holder = document.createElement("div"); holder.className = "diff-doc"; holder.append(bar, surface); pane.append(holder);
    diff = mountDiff(surface, data, () => onOpenCurrent(file.path), { toolbar: bar });
    bar.querySelector(".diff-toolbar").prepend(label);
  };
  function showWorkspaceDiff(data) {
    const request = ++serial;
    clear(); selected = ""; workspaceSelection = undefined; workspaceOverview = true;
    pane.classList.remove("historical-file"); pane.replaceChildren(); onTitle?.("Working changes");
    list.querySelectorAll(".commit-row").forEach(row => row.setAttribute("aria-current", "false"));
    const files = data.groups.flatMap(group => group.files.map(file => ({ ...file, group: group.id })));
    appendFiles(files, async (body, file, toggle) => {
      const content = await workspaceFile(file.group, file.path);
      if (!valid(request) || body.hidden) return;
      if (isImagePath(file.path)) body.replaceChildren(imagePreview(content.url, file.path));
      else commitDiffs.set(toggle, diffView(body, content, () => onOpenCurrent(file.path), true));
    });
    if (!files.length) { const empty = document.createElement("p"); empty.className = "git-empty"; empty.textContent = "No uncommitted changes"; pane.append(empty); }
  }
  function renderWorkspace(data) {
    workspace.replaceChildren();
    const heading = document.createElement("div"); heading.className = "workspace-heading";
    const header = document.createElement("h3"); header.textContent = `Changes · ${data.count}`;
    const layouts = document.createElement("nav"); layouts.className = "segmented"; layouts.setAttribute("aria-label", "Git file layout");
    for (const [tree, label] of [[true, "Tree"], [false, "Flat"]]) {
      const control = button(label, () => { workspaceTree = tree; renderWorkspace(data); });
      control.setAttribute("aria-pressed", String(workspaceTree === tree)); layouts.append(control);
    }
    heading.append(header, layouts);
    const total = button("", () => showWorkspaceDiff(data), "workspace-total");
    total.append(document.createTextNode("± View diff"), statsNode(data, "totals"));
    if (data.unavailable) total.title = "Line counts exclude files without text statistics";
    if (data.truncated) total.title = "Partial results";
    if (data.count) workspace.append(heading, total);
    for (const group of data.groups.filter(group => group.files.length)) {
      const section = document.createElement("details"); section.className = "workspace-group"; section.open = true;
      const summary = document.createElement("summary"); summary.textContent = `${{ staged: "Staged", unstaged: "Unstaged", untracked: "Untracked" }[group.id]} · ${group.files.length}  +${group.added} −${group.deleted}`;
      if (group.unavailable) summary.title = "Line counts exclude files without text statistics";
      section.append(summary);
      const files = document.createElement("div"); files.className = workspaceTree ? "workspace-tree" : "workspace-flat";
      section.append(files);
      const directories = new Map([["", files]]);
      for (const file of [...group.files].sort((a, b) => a.path.localeCompare(b.path))) {
        let parent = files;
        if (workspaceTree) {
          let path = "";
          for (const part of file.path.split("/").slice(0, -1)) {
            path += part + "/";
            if (!directories.has(path)) {
              const directory = document.createElement("details"); directory.className = "workspace-dir";
              const key = group.id + ":" + path; directory.open = !closedFolders.has(key);
              const toggle = document.createElement("summary");
              toggle.innerHTML = '<svg class="icon workspace-folder-icon"><use href="#i-folder"/></svg>';
              const name = document.createElement("span"); name.className = "workspace-folder-name"; name.textContent = part; toggle.append(name);
              const children = document.createElement("div");
              directory.append(toggle, children); parent.append(directory); directories.set(path, children);
              directory.ontoggle = () => { if (directory.open) closedFolders.delete(key); else closedFolders.add(key); };
            }
            parent = directories.get(path);
          }
        }
        const row = button("", () => chooseWorkspace(group.id, file), "workspace-file");
        row.dataset.path = file.path;
        row.title = file.path; row.dataset.group = group.id;
        row.setAttribute("aria-current", String(workspaceSelection?.group === group.id && workspaceSelection?.path === file.path));
        const icon = document.createElement("span"); icon.className = "workspace-file-icon"; icon.innerHTML = '<svg class="icon"><use href="#i-file"/></svg>';
        const name = document.createElement("span"); name.className = "workspace-file-name"; name.textContent = workspaceTree ? file.path.split("/").at(-1) : file.path;
        row.append(icon, name, statsNode(file, "workspace-file-stats"));
        parent.append(row);
      }
      workspace.append(section);
    }
    if (!data.count) {
      const empty = document.createElement("p"); empty.className = "git-empty"; empty.textContent = "No uncommitted changes";
      workspace.append(empty);
    }
  }
  async function refreshWorkspace() {
    const request = ++listSerial;
    const data = await call("workspace"); if (stopped || !pane.isConnected || request !== listSerial) return;
    renderWorkspace(data);
    if (workspaceOverview) { showWorkspaceDiff(data); return; }
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
      const hash = document.createElement("span"); hash.className = "commit-hash"; hash.textContent = `${commit.author} · ${commit.hash.slice(0, 7)}`;
      const bottom = document.createElement("span"); bottom.className = "commit-bottom";
      const date = document.createElement("time"); date.className = "commit-date"; date.dateTime = commit.date;
      date.title = new Date(commit.date).toLocaleString();
      date.textContent = `${new Date(commit.date).toLocaleTimeString()} · ${ago(commit.date)}`;
      const stat = document.createElement("span"); stat.className = "commit-stats";
      const added = document.createElement("span"); added.className = "added"; added.textContent = "+" + commit.added;
      const deleted = document.createElement("span"); deleted.className = "deleted"; deleted.textContent = "−" + commit.deleted;
      stat.append(added, deleted);
      if (commit.unavailable) stat.title = "Line counts exclude files without text statistics";
      bottom.append(date, stat); row.append(subject, hash, bottom);
      list.append(row);
    }
    if (!data.commits.length) list.append(document.createTextNode("No commits"));
    if (skip) list.append(button("Previous page", () => { skip = Math.max(0, skip - 50); return loadList(); }));
    if (data.commits.length === 50) list.append(button("Next page", () => { skip += 50; return loadList(); }));
    if (!selected && !workspaceSelection && !workspaceOverview && data.commits.length) await details(data.commits[0].hash);
  }
  try {
    const data = await call("refs"); if (!stopped) data.refs.forEach(r => addRef(r.name, r.hash));
    await refreshWorkspace(); await loadList();
  } catch (e) {
    if (!stopped && pane.isConnected) {
      repository = !e.message.includes("not a git repository");
      const message = repository ? "Git could not be loaded: " + e.message : "This folder isn’t a Git repository";
      const empty = document.createElement("p"); empty.className = "git-empty"; empty.textContent = message;
      const indexEmpty = empty.cloneNode(true);
      pane.replaceChildren(empty); index.replaceChildren(indexEmpty);
    }
  }
  const dispose = () => { stopped = true; serial++; listSerial++; logSerial++; clear(); document.removeEventListener("click", closeRefs); };
  dispose.refresh = async () => { if (repository) { await refreshWorkspace(); await loadList(); } };
  return dispose;
}
