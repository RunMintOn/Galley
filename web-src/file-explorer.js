const $ = id => document.getElementById(id);
const parentPath = path => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const baseName = path => path.split("/").at(-1);
const within = (path, parent) => path === parent || path.startsWith(parent + "/");
const icon = name => `<svg class="icon"><use href="#i-${name}"/></svg>`;

export function createFileExplorer({ api, root, current, expanded, fileButton, notice, onWatch, showTree, open, openNew, beforeRemove, onMutation }) {
  const tree = $("tree"), menu = $("file-context"), picker = $("file-picker"), query = $("file-query"), results = $("file-results");
  let project, serial = 0, selection, clipboard, undoId, undoItem, working = false, naming, searchRoot, searchFiles = [], searchSerial = 0, matches = [], active = 0;
  const storageKey = () => "review-tree-expanded:" + root();
  const saveExpanded = () => localStorage.setItem(storageKey(), JSON.stringify([...expanded]));
  const safely = fn => async (...args) => { try { await fn(...args); } catch (error) { notice(error.message); } };
  const rowFor = path => tree.querySelector(`[data-path="${CSS.escape(path)}"]`);
  function select(item) {
    selection = item;
    for (const row of tree.querySelectorAll("[data-path]")) {
      row.classList.toggle("tree-selected", item?.root === root() && row.dataset.path === item.path);
    }
  }
  function itemFor(row) {
    return { root: root(), path: row?.dataset.path || "", directory: row?.dataset.directory === "true" || !row };
  }
  function folder(item) { return item.directory ? item.path : parentPath(item.path); }
  function restoreProject() {
    if (project === root()) return;
    project = root(); expanded.clear(); expanded.add("");
    for (const path of JSON.parse(localStorage.getItem(storageKey()) || "[]")) expanded.add(path);
    selection = undefined;
  }
  async function refresh() {
    if (naming && project === root() && !working) return;
    restoreProject();
    const request = ++serial, atRoot = root();
    if (!atRoot) { tree.replaceChildren(); return; }
    const focused = tree.contains(document.activeElement) ? document.activeElement.closest("[data-path]")?.dataset.path : null;
    const scroll = $("review-index").scrollTop;
    async function build(path) {
      const data = await api("tree?" + new URLSearchParams({ root: atRoot, path }));
      const fragment = document.createDocumentFragment();
      if (!data.entries.length) {
        const empty = document.createElement("div"); empty.className = "tree-empty";
        empty.textContent = data.hidden.length ? "Only hidden items" : "Empty folder";
        empty.title = data.hidden.join(", "); fragment.append(empty);
      }
      for (const item of data.entries) {
        const pathHere = path ? path + "/" + item.name : item.name;
        let row;
        if (item.directory) {
          const details = document.createElement("details"); details.className = "tree-dir";
          row = document.createElement("summary"); row.innerHTML = icon("folder");
          const name = document.createElement("span"); name.className = "tree-name"; name.textContent = item.name; row.append(name);
          const children = document.createElement("div"); details.append(row, children);
          details.open = expanded.has(pathHere);
          if (details.open) children.append(await build(pathHere));
          details.ontoggle = safely(async () => {
            if (!details.isConnected) return;
            if (details.open) {
              expanded.add(pathHere);
              if (!children.children.length) children.replaceChildren(await build(pathHere));
            } else {
              for (const path of expanded) if (within(path, pathHere)) expanded.delete(path);
              children.replaceChildren();
            }
            saveExpanded(); onWatch();
          });
          fragment.append(details);
        } else {
          row = fileButton(pathHere, () => open(pathHere));
          row.querySelector(".file-name").textContent = item.name + (item.link ? " ↗" : "");
          row.setAttribute("aria-current", String(current() === pathHere));
          fragment.append(row);
        }
        row.dataset.path = pathHere; row.dataset.directory = String(item.directory); row.title = pathHere;
        row.classList.toggle("tree-selected", selection?.root === atRoot && selection.path === pathHere);
        row.classList.toggle("tree-cut", !!clipboard?.cut && clipboard.root === atRoot && clipboard.path === pathHere);
      }
      if (data.truncated) {
        const warning = document.createElement("p"); warning.className = "tree-empty";
        warning.textContent = "Showing the first 2000 entries"; fragment.append(warning);
      }
      return fragment;
    }
    const content = await build("");
    if (request !== serial || root() !== atRoot) return;
    cancelName();
    tree.replaceChildren(content);
    document.querySelector(".tree-heading").hidden = false;
    $("review-index").scrollTop = scroll;
    if (focused) rowFor(focused)?.focus({ preventScroll: true });
    onWatch();
  }
  function openAncestors(path) {
    let parent = parentPath(path);
    while (parent) { expanded.add(parent); parent = parentPath(parent); }
    saveExpanded();
  }
  async function reveal(path = current()) {
    if (!path) return;
    showTree(); openAncestors(path); await refresh();
    const row = rowFor(path);
    if (!row) { notice("This file is not shown by the file tree"); return; }
    select(itemFor(row)); row.scrollIntoView({ block: "nearest" }); row.focus({ preventScroll: true });
  }
  async function apply(result) {
    if (result.move) {
      const { from, to } = result.move;
      if (from.root === root()) {
        for (const path of [...expanded]) if (within(path, from.path)) {
          expanded.delete(path);
          if (to.root === root()) expanded.add(to.path + path.slice(from.path.length));
        }
        saveExpanded();
      }
      if (selection?.root === from.root && within(selection.path, from.path)) {
        selection = { ...selection, root: to.root, path: to.path + selection.path.slice(from.path.length) };
      }
    }
    if (result.removed) {
      if (selection?.root === result.removed.root && within(selection.path, result.removed.path)) selection = undefined;
      if (result.removed.root === root()) {
        for (const path of [...expanded]) if (within(path, result.removed.path)) expanded.delete(path);
        saveExpanded();
      }
    }
    await onMutation(result);
    searchRoot = undefined;
    await refresh();
  }
  async function undo() {
    if (!undoId || working) return;
    if (undoItem && !await beforeRemove(undoItem)) return;
    working = true;
    try {
      const result = await api("files/undo", { id: undoId });
      undoId = undefined; await apply(result); notice(result.message);
    } finally { working = false; }
  }
  async function perform(body) {
    if (working) return;
    if (body.action === "trash" && !await beforeRemove({ root: body.root, path: body.path })) return;
    working = true;
    try {
      const result = await api("files/action", body);
      undoId = result.undo;
      undoItem = !result.move && !result.removed ? { root: result.root, path: result.path } : undefined;
      await apply(result);
      notice(result.message, { label: "Undo", run: undo });
      return result;
    } finally { working = false; }
  }
  function cancelName() {
    if (!naming) return;
    naming.cancel(); naming = undefined;
  }
  async function nameItem(item, action) {
    cancelName();
    const atRoot = item.root, parent = action === "rename" ? parentPath(item.path) : folder(item);
    showTree();
    openAncestors(parent ? parent + "/_" : "_");
    if (parent) expanded.add(parent);
    saveExpanded(); await refresh();
    const input = document.createElement("input"); input.className = "tree-name-input"; input.setAttribute("aria-label", action === "rename" ? "Rename" : action === "folder" ? "New folder name" : "New file name");
    let row, label;
    if (action === "rename") {
      row = rowFor(item.path); label = row.querySelector(".file-name, .tree-name"); label.hidden = true;
      input.value = baseName(item.path); label.after(input);
    } else {
      row = document.createElement("div"); row.className = "file-button tree-creating";
      row.innerHTML = icon(action === "folder" ? "folder" : "file"); row.append(input);
      const container = parent ? rowFor(parent).parentElement.lastElementChild : tree;
      container.querySelector(":scope > .tree-empty")?.remove(); container.prepend(row);
    }
    const cancel = () => { if (label) { label.hidden = false; input.remove(); } else row.remove(); };
    naming = { cancel };
    input.addEventListener("click", event => event.stopPropagation());
    input.addEventListener("keydown", safely(async event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); cancelName(); rowFor(item.path)?.focus(); }
      if (event.key !== "Enter" || event.isComposing || !input.value.trim()) return;
      event.preventDefault(); input.disabled = true;
      try {
        const result = await perform({ action, root: atRoot, path: item.path, parent, name: input.value.trim() });
        if (result) {
          if (action === "file" && atRoot === root()) await openNew(result.path);
          else if (atRoot === root()) await reveal(result.path);
        }
      } finally { input.disabled = false; input.focus(); }
    }));
    input.focus(); input.select();
  }
  async function writeClipboard(text) {
    if (window.mygo) await window.mygo.call("Desktop.CopyText", text);
    else await navigator.clipboard.writeText(text);
  }
  function copyItem(item, cut, event) {
    clipboard = { ...item, cut };
    const text = item.root + "/" + item.path;
    if (event?.clipboardData) event.clipboardData.setData("text/plain", text);
    else safely(writeClipboard)(text);
    for (const row of tree.querySelectorAll("[data-path]")) row.classList.toggle("tree-cut", cut && row.dataset.path === item.path && item.root === root());
    notice(cut ? `Cut ${baseName(item.path)}. Choose a folder and paste; Esc cancels.` : `Copied ${baseName(item.path)}. Choose a folder and paste.`);
  }
  async function paste(item) {
    if (!clipboard) return;
    const copied = clipboard;
    let name = baseName(copied.path);
    while (true) {
      try {
        const result = await perform({ action: copied.cut ? "move" : "copy", root: copied.root, path: copied.path, targetRoot: item.root, parent: folder(item), name });
        if (result && copied.cut) clearClipboard();
        if (result && item.root === root()) await reveal(result.path);
        return;
      } catch (error) {
        if (!error.message.includes("already exists")) throw error;
        name = prompt(error.message + "\nNew name:", name);
        if (!name) return;
      }
    }
  }
  function clearClipboard() {
    clipboard = undefined;
    tree.querySelectorAll(".tree-cut").forEach(row => row.classList.remove("tree-cut"));
  }
  function closeMenu() { menu.hidden = true; }
  function menuButton(label, action, key = "", disabled = false) {
    const button = document.createElement("button"); button.setAttribute("role", "menuitem"); button.disabled = disabled;
    const text = document.createElement("span"); text.textContent = label; button.append(text);
    if (key) { const hint = document.createElement("kbd"); hint.textContent = key; hint.setAttribute("aria-hidden", "true"); button.append(hint); }
    button.onclick = safely(async () => { closeMenu(); await action(); });
    menu.append(button);
  }
  const divider = () => menu.append(document.createElement("hr"));
  async function context(event, item, editable) {
    event.preventDefault();
    cancelName(); closeMenu();
    const info = await api("files/info?" + new URLSearchParams({ root: item.root, path: item.path }));
    item = { ...item, directory: info.directory };
    menu.replaceChildren();
    if (editable) {
      select(item);
      menuButton("New File", () => nameItem(item, "file"), "⌘N");
      menuButton("New Folder", () => nameItem(item, "folder"), "⌥⌘N");
      divider();
    } else if (item.path) {
      menuButton("Reveal in File Tree", () => reveal(item.path));
      menuButton("Open Current File", () => open(item.path), "", !info.exists || info.directory);
    }
    const system = action => api("files/system", { root: item.root, path: item.path, action });
    menuButton("Reveal in Finder", () => system("reveal"), "", !info.exists);
    menuButton("Open in Default App", () => system("open"), "", !info.exists);
    menuButton("Open in Terminal", () => system("terminal"), "", !info.exists);
    divider();
    if (editable) {
      menuButton("Cut", () => copyItem(item, true), "⌘X", !item.path);
      menuButton("Copy", () => copyItem(item, false), "⌘C", !item.path);
      menuButton("Duplicate", () => perform({ action: "duplicate", root: item.root, path: item.path }), "⌘D", !item.path);
      menuButton("Paste", () => paste(item), "⌘V", !clipboard);
      divider();
    }
    menuButton("Copy Path", async () => { await writeClipboard(info.absolute); notice("Copied path"); });
    menuButton("Copy Relative Path", async () => { await writeClipboard(item.path || "."); notice("Copied relative path"); });
    if (editable && item.path) {
      divider();
      menuButton("Rename", () => nameItem(item, "rename"), "F2");
      menuButton("Move to Trash", () => perform({ action: "trash", root: item.root, path: item.path }), "⌘⌫");
    }
    menu.hidden = false;
    menu.style.left = Math.min(event.clientX, innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)) + "px";
    menu.querySelector("button:not(:disabled)")?.focus();
  }
  tree.addEventListener("contextmenu", safely(event => context(event, itemFor(event.target.closest("[data-path]")), true)));
  tree.addEventListener("click", event => {
    const row = event.target.closest("[data-path]");
    if (row) select(itemFor(row));
  });
  for (const id of ["changed", "git-index", "content"]) {
    $(id).addEventListener("contextmenu", safely(event => {
      const row = event.target.closest("[data-path], [data-history-path]");
      if (row) return context(event, { root: root(), path: row.dataset.path || row.dataset.historyPath }, false);
    }));
  }
  $("review-index").addEventListener("contextmenu", safely(event => {
    if (event.target.closest("#tree, #changed [data-path]")) return;
    return context(event, { root: root(), path: "", directory: true }, true);
  }));
  document.addEventListener("pointerdown", event => {
    if (!menu.contains(event.target)) closeMenu();
    if (naming && !event.target.closest(".tree-name-input")) cancelName();
  });
  menu.addEventListener("keydown", event => {
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")], at = buttons.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End", "Escape"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
    if (event.key === "Escape") { closeMenu(); rowFor(selection?.path || "")?.focus(); }
    if (event.key === "ArrowDown") buttons[(at + 1) % buttons.length]?.focus();
    if (event.key === "ArrowUp") buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    if (event.key === "Home") buttons[0]?.focus();
    if (event.key === "End") buttons.at(-1)?.focus();
  });

  function score(path, text) {
    const name = baseName(path).toLowerCase(), value = path.toLowerCase();
    if (!text) return 0;
    if (name === text) return 10000;
    if (name.startsWith(text)) return 8000 - name.length;
    if (name.includes(text)) return 6000 - name.length;
    if (value.includes(text)) return 4000 - value.length;
    let at = 0;
    for (const char of value) if (char === text[at]) at++;
    return at === text.length ? 2000 - value.length : -1;
  }
  function selectResult(index) {
    active = index;
    [...results.children].forEach((row, at) => row.setAttribute("aria-selected", String(at === active)));
    const selected = results.children[active];
    query.setAttribute("aria-activedescendant", selected?.id || "");
    selected?.scrollIntoView({ block: "nearest" });
  }
  function renderResults() {
    const text = query.value.toLowerCase().trim();
    matches = searchFiles.map(path => ({ path, score: score(path, text) })).filter(item => item.score >= 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 80);
    results.replaceChildren();
    for (const [index, item] of matches.entries()) {
      const row = document.createElement("button"); row.id = "file-result-" + index; row.setAttribute("role", "option"); row.tabIndex = -1;
      const name = document.createElement("span"); name.textContent = baseName(item.path);
      const path = document.createElement("small"); path.textContent = parentPath(item.path) || ".";
      row.append(name, path); results.append(row);
      row.onclick = safely(async () => { picker.close(); await open(item.path); });
      row.onpointermove = () => selectResult(index);
    }
    $("file-search-status").textContent = matches.length ? "" : "No matching files";
    selectResult(0);
  }
  async function quickOpen() {
    if (!root()) return;
    if (!picker.open) picker.showModal();
    query.value = ""; matches = []; results.replaceChildren(); $("file-search-status").textContent = "Loading files…"; query.focus();
    const atRoot = root(), request = ++searchSerial;
    try {
      if (searchRoot !== atRoot) {
        searchFiles = [];
        const data = await api("files/search?" + new URLSearchParams({ root: atRoot }));
        if (request !== searchSerial || atRoot !== root()) return;
        searchFiles = data.files; searchRoot = atRoot;
      }
      renderResults();
    } catch (error) { $("file-search-status").textContent = error.message; }
  }
  query.addEventListener("input", renderResults);
  query.addEventListener("keydown", safely(async event => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length) selectResult((active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    }
    if (event.key === "Enter" && matches[active]) { event.preventDefault(); picker.close(); await open(matches[active].path); }
  }));
  picker.addEventListener("keydown", event => event.stopPropagation());
  picker.addEventListener("click", event => { if (event.target === picker) picker.close(); });
  picker.addEventListener("close", () => searchSerial++);
  $("find-file").onclick = safely(quickOpen);
  $("reveal-file").onclick = safely(() => reveal());
  $("collapse-tree").onclick = safely(async () => { expanded.clear(); expanded.add(""); saveExpanded(); await refresh(); });
  const selectedItem = () => selection?.root === root() ? selection : { root: root(), path: "", directory: true };
  $("new-file").onclick = safely(() => nameItem(selectedItem(), "file"));
  $("new-folder").onclick = safely(() => nameItem(selectedItem(), "folder"));
  document.addEventListener("keydown", safely(async event => {
    const typing = event.target.closest("input,textarea,select,[contenteditable=true]");
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p" && !event.shiftKey) {
      event.preventDefault(); event.stopImmediatePropagation(); await quickOpen(); return;
    }
    if (event.key === "Escape" && !typing && clipboard?.cut) { clearClipboard(); notice("Cut cancelled"); return; }
    if (!tree.contains(event.target) || typing) return;
    const row = event.target.closest("[data-path]"), item = row ? itemFor(row) : { root: root(), path: "", directory: true };
    const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const rows = [...tree.querySelectorAll("[data-path]")].filter(row => row.getClientRects().length), at = rows.indexOf(row);
      let next;
      if (event.key === "ArrowDown") next = rows[Math.min(rows.length - 1, at + 1)];
      if (event.key === "ArrowUp") next = rows[Math.max(0, at - 1)];
      if (event.key === "Home") next = rows[0];
      if (event.key === "End") next = rows.at(-1);
      if (event.key === "ArrowRight") {
        if (item.directory && !row.parentElement.open) row.parentElement.open = true;
        else if (item.directory) next = rows[at + 1];
      }
      if (event.key === "ArrowLeft") {
        if (item.directory && row.parentElement.open) row.parentElement.open = false;
        else next = rowFor(parentPath(item.path));
      }
      if (next) { select(itemFor(next)); next.focus(); }
      return;
    }
    let action;
    if (mod && key === "n") action = () => nameItem(item, event.altKey ? "folder" : "file");
    if (event.key === "F2" && item.path) action = () => nameItem(item, "rename");
    if (mod && key === "d" && item.path) action = () => perform({ action: "duplicate", root: item.root, path: item.path });
    if (mod && key === "v" && clipboard) action = () => paste(item);
    if (mod && (key === "c" || key === "x") && item.path) action = () => copyItem(item, key === "x");
    if (mod && key === "z" && !event.shiftKey && undoId) action = undo;
    if (mod && event.key === "Backspace" && item.path) action = () => perform({ action: "trash", root: item.root, path: item.path });
    if (action) { event.preventDefault(); event.stopImmediatePropagation(); await action(); }
  }), true);
  for (const type of ["copy", "cut", "paste"]) document.addEventListener(type, safely(async event => {
    const row = document.activeElement.closest("#tree [data-path]");
    if (!row || document.activeElement.matches("input")) {
      if (type !== "paste") clearClipboard();
      return;
    }
    if (type === "paste" && !clipboard) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (type === "paste") await paste(itemFor(row));
    else copyItem(itemFor(row), type === "cut", event);
  }), true);
  return { refresh, reveal, quickOpen, undo, get busy() { return working; }, invalidateSearch() { searchRoot = undefined; } };
}
