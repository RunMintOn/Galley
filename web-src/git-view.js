import { mountDiff } from "./diff.js";
import { createFileEditor } from "./editor.js";

export async function showGitHistory(container, { root, api, onOpenCurrent, onError }) {
  const pane = document.createElement("div"); pane.className = "git-view";
  container.replaceChildren(pane);
  let selectedHash = "", skip = 0, historicalEditor, version = 0;
  const query = values => new URLSearchParams({ root, ...values });
  const call = (op, values = {}) => api("git/" + op + "?" + query(values));
  const button = (text, action) => {
    const node = document.createElement("button"); node.textContent = text;
    node.onclick = () => Promise.resolve().then(action).catch(onError); return node;
  };
  const header = document.createElement("div"); header.className = "file-toolbar";
  const label = document.createElement("span"); label.textContent = "Git 历史 · 独立于右栏轮次";
  const refs = document.createElement("select"); refs.setAttribute("aria-label", "历史分支引用");
  refs.append(new Option("HEAD", ""));
  header.append(label, refs);
  const body = document.createElement("div"); body.className = "git-body";
  pane.append(header, body);
  const active = () => pane.isConnected;
  async function list() {
    const request = ++version;
    historicalEditor?.destroy(); historicalEditor = undefined;
    const data = await call("log", { skip: String(skip), ...(selectedHash ? { hash: selectedHash } : {}) });
    if (!active() || request !== version) return;
    body.replaceChildren();
    for (const commit of data.commits) {
      const b = button(`${commit.hash.slice(0, 8)}  ${commit.subject}\n${commit.author} · ${new Date(commit.date).toLocaleString()}`, () => details(commit.hash));
      b.className = "commit-row"; body.append(b);
    }
    if (!data.commits.length) body.append(document.createTextNode("没有提交"));
    const page = document.createElement("div"); page.className = "file-toolbar";
    if (skip) page.append(button("上一页", () => { skip = Math.max(0, skip - 50); return list(); }));
    if (data.commits.length === 50) page.append(button("下一页", () => { skip += 50; return list(); }));
    body.append(page);
  }
  async function details(hash, parent = 0) {
    const request = ++version;
    historicalEditor?.destroy(); historicalEditor = undefined;
    const data = await call("commit", { hash, parent: String(parent) });
    if (!active() || request !== version) return;
    body.replaceChildren();
    const bar = document.createElement("div"); bar.className = "file-toolbar";
    const source = document.createElement("span"); source.textContent = `${hash.slice(0, 8)} ← ${data.parent?.slice(0, 8) || "空树（根提交）"}`;
    bar.append(button("返回提交列表", list), source);
    if (data.parents.length > 1) {
      const select = document.createElement("select"); select.setAttribute("aria-label", "比较父版本");
      data.parents.forEach((p, i) => select.append(new Option(`父版本 ${i + 1}: ${p.slice(0, 8)}`, String(i))));
      select.value = String(parent);
      select.onchange = () => details(hash, Number(select.value)).catch(onError);
      bar.append(select);
    }
    const files = document.createElement("div"); files.className = "git-files";
    const view = document.createElement("div");
    for (const file of data.files) files.append(button(`${file.path} +${file.added} −${file.deleted}`, () => {
      historicalEditor?.destroy(); historicalEditor = undefined;
      const diff = document.createElement("div"); diff.className = "diff-surface"; view.replaceChildren(diff);
      mountDiff(diff, file, () => historical(file.path, file.status === "Deleted" ? data.parent : hash, view));
    }));
    body.append(bar, files, view);
    if (data.truncated) { const warning = document.createElement("p"); warning.textContent = "提交包含过多文件，仅加载前 500 个"; body.append(warning); }
    files.querySelector("button")?.click();
  }
  async function historical(path, hash, view) {
    const request = ++version;
    const file = await call("file", { hash, path });
    if (!active() || request !== version) return;
    historicalEditor?.destroy();
    const holder = document.createElement("div"); holder.className = "historical-file";
    const bar = document.createElement("div"); bar.className = "file-toolbar";
    const label = document.createElement("span"); label.textContent = `${path} @ ${hash.slice(0, 8)} · 历史只读`;
    bar.append(label, button("打开当前文件", () => onOpenCurrent(path)), button("Blame", async () => {
      const result = await call("blame", { hash, path });
      if (!active()) return;
      const pre = document.createElement("pre"); pre.className = "blame"; pre.textContent = result.text;
      view.replaceChildren(bar, pre); historicalEditor?.destroy(); historicalEditor = undefined;
    }));
    const host = document.createElement("div"); host.className = "editor-host";
    holder.append(bar, host); view.replaceChildren(holder);
    historicalEditor = createFileEditor(host, { ...file, partial: true }, () => {}, () => {});
  }
  refs.onchange = () => { selectedHash = refs.value; skip = 0; list().catch(onError); };
  try {
    const data = await call("refs");
    if (!active()) return;
    data.refs.forEach(ref => refs.append(new Option(ref.name, ref.hash)));
    await list();
  } catch (e) {
    if (active()) { body.textContent = "Git 历史不可用：" + e.message; }
  }
  return () => historicalEditor?.destroy();
}
