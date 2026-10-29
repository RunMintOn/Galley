import * as Diff from "diff";

// Rendering core migrated from compact-tool; the container owns all listeners.
export function mountDiff(root, file, onOpen, { initialLayout = "unified" } = {}) {
  let layout = initialLayout;
  let hunkId = 0, foldId = 0;
  const escape = text => text.replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
  // src/diff.ts already stripped the +/-/space marker, so content is the raw line.
  const lineText = line => line.content ?? "";
  // Only the source markers are tinted; they stay visible because the markers
  // themselves are frequently what changed.
  function markdown(escaped) {
    if (/^\s*(```|~~~)/.test(escaped)) return `<span class="m-fence">${escaped}</span>`;
    if (/^\s*#{1,6}\s/.test(escaped)) return `<span class="m-heading">${escaped}</span>`;
    if (/^\s*\|/.test(escaped)) return `<span class="m-table">${escaped}</span>`;
    if (/^\s*>\s/.test(escaped)) return `<span class="m-quote">${escaped}</span>`;
    return escaped
      .replace(/`([^`]+)`/g, '<span class="m-code">`$1`</span>')
      .replace(/\*\*([^*]+)\*\*/g, '<span class="m-strong">**$1**</span>');
  }
  // Pair each run of deletions with the insertions that replaced it. One pair
  // feeds both layouts: unified prints the two sides on separate rows, split
  // prints them side by side, and only the changed words get marked.
  function pairs(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== "delete") {
        const line = lines[i];
        const side = { number: line.type === "insert" ? line.newNumber : line.oldNumber, html: markdown(escape(lineText(line))) };
        out.push(line.type === "insert" ? { type: "insert", old: null, next: side } : { type: "context", old: side, next: { ...side, number: line.newNumber } });
        continue;
      }
      const deleted = [];
      const inserted = [];
      while (i < lines.length && lines[i].type === "delete") deleted.push(lines[i++]);
      while (i < lines.length && lines[i].type === "insert") inserted.push(lines[i++]);
      i--;
      for (let k = 0; k < Math.max(deleted.length, inserted.length); k++) {
        const before = deleted[k];
        const after = inserted[k];
        if (before && after) {
          // Keep whitespace: diffWords ignores it, so a pure indentation change
          // would render both sides identically and mark nothing.
          const parts = Diff.diffWordsWithSpace(lineText(before), lineText(after));
          out.push({
            type: "change",
            old: { number: before.oldNumber, html: parts.filter(part => !part.added)
              .map(part => part.removed ? `<i class="hl-d">${escape(part.value)}</i>` : markdown(escape(part.value))).join("") },
            next: { number: after.newNumber, html: parts.filter(part => !part.removed)
              .map(part => part.added ? `<i class="hl-i">${escape(part.value)}</i>` : markdown(escape(part.value))).join("") },
          });
        } else if (before) {
          out.push({ type: "delete", old: { number: before.oldNumber, html: markdown(escape(lineText(before))) }, next: null });
        } else {
          out.push({ type: "insert", old: null, next: { number: after.newNumber, html: markdown(escape(lineText(after))) } });
        }
      }
    }
    return out;
  }

  const sign = { insert: "+", delete: "−", context: " " };
  function unifiedRows(pair) {
    if (pair.type === "context") return [["context", " ", pair.old.number, pair.next.number, pair.old.html]];
    if (pair.type === "change") {
      return [
        ["delete", sign.delete, pair.old.number, "", pair.old.html],
        ["insert", sign.insert, "", pair.next.number, pair.next.html],
      ];
    }
    const side = pair.old ?? pair.next;
    return [[pair.type, sign[pair.type], pair.old ? side.number : "", pair.next ? side.number : "", side.html]];
  }
  function unifiedHTML(pair) {
    return unifiedRows(pair).map(([type, mark, oldNumber, newNumber, html]) =>
      `<tr class="${type}"><td class="ln">${oldNumber}</td><td class="ln">${newNumber}</td>` +
      `<td class="sign">${mark}</td><td class="content">${html}</td></tr>`).join("");
  }
  function splitHTML(pair) {
    const side = (cell, type) => cell
      ? `<td class="ln">${cell.number}</td><td class="content ${type}">${cell.html}</td>`
      : '<td class="ln filler"></td><td class="content filler"></td>';
    const left = pair.old ? (pair.type === "insert" ? "filler" : pair.type === "context" ? "context" : "delete") : "filler";
    const right = pair.next ? (pair.type === "delete" ? "filler" : pair.type === "context" ? "context" : "insert") : "filler";
    return `<tr class="${pair.type}">${side(pair.old, left)}<td class="gutter"></td>${side(pair.next, right)}</tr>`;
  }
  const foldHTML = (hidden, id) =>
    `<tr class="fold"><td colspan="5"><div><span>${hidden} unchanged line${hidden === 1 ? "" : "s"}</span>` +
    `<span class="rule"></span><button type="button" data-fold="${id}">show</button></div></td></tr>`;
  // Hidden context rows stay in the DOM so expanding is a class toggle rather
  // than a second render pass. Each fold gets its own id: sharing one per hunk
  // would make every toggle in that hunk open and close together.
  const foldedHTML = (row, id) => row.replace(/^<tr class="(\w+)"/, `<tr class="$1 folded" data-fold="${id}" hidden`);

  function hunkHTML(block) {
    const id = hunkId++;
    const all = pairs(block.lines);
    const render = layout === "split" ? splitHTML : unifiedHTML;
    let body = "";
    let index = 0;
    while (index < all.length) {
      if (all[index].type !== "context") {
        body += render(all[index++]);
        continue;
      }
      let end = index;
      while (end < all.length && all[end].type === "context") end++;
      const run = all.slice(index, end);
      // Keep two lines against each edge so a hunk still shows where it sits.
      if (run.length > 6 && index > 0 && end < all.length) {
        const fold = foldId++;
        body += render(run[0]) + render(run[1]) + foldHTML(run.length - 4, fold);
        body += run.slice(2, -2).map(row => foldedHTML(render(row), fold)).join("");
        body += render(run[run.length - 2]) + render(run[run.length - 1]);
      } else {
        body += run.map(render).join("");
      }
      index = end;
    }
    const range = `-${block.oldStartLine},${block.oldLineCount} +${block.newStartLine},${block.newLineCount}`;
    const changes = block.lines.filter(line => line.type !== "context").length;
    return `<div class="hunk" id="hunk-${id}" data-changes="${changes}">` +
      `<span class="k">hunk</span><span class="h">${escape(range)}</span>` +
      `<span class="count">${changes} change${changes === 1 ? "" : "s"}</span></div>` +
      `<div class="scroll"><table class="diff"><tbody>${body}</tbody></table></div>`;
  }


  root.innerHTML = '<div class="diff-controls"><div class="layout-switch"><button data-layout="unified">Unified</button><button data-layout="split">Split</button></div><button data-open aria-label="完整文件" title="打开完整文件">↗</button><label><input type="checkbox" data-wrap checked> wrap</label></div><div class="diffs"></div>';
  const controls = root.querySelector(".diff-controls");
  const wrap = controls.querySelector("label");
  const diffs = root.querySelector(".diffs");
  let hunk = -1;
  function render() {
    hunkId = 0; foldId = 0;
    diffs.dataset.layout = layout;
    diffs.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "file-head";
    heading.textContent = file.path + " · " + file.status + (file.status === "Unavailable" || file.countable === false ? " · 行数不可用" : "  +" + file.added + " −" + file.deleted);
    diffs.append(heading);
    if (file.diff?.blocks.length) diffs.insertAdjacentHTML("beforeend",file.diff.blocks.map((block, index, blocks) => {
      const previous = blocks[index - 1];
      const hidden = previous ? block.oldStartLine - previous.oldStartLine - previous.oldLineCount : 0;
      return (hidden > 0 ? `<div class="hunk-gap">还有 ${hidden} 行未改动</div>` : "") + hunkHTML(block);
    }).join(""));
    else {
      const notice = document.createElement("p");
      notice.className = "notice";
      notice.textContent = file.notice || "无文本差异";
      diffs.append(notice);
    }
    controls.querySelectorAll("[data-layout]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.layout===layout)));
  }
  const nav = (step) => {
    const hunks = [...diffs.querySelectorAll(".hunk")];
    hunk = Math.max(0,Math.min(hunks.length-1,hunk+step));
    hunks[hunk]?.scrollIntoView({block:"start"});
  };
  function action(event) {
    const b=event.target.closest("button");
    if(!b)return;
    if(b.dataset.layout){
      layout=b.dataset.layout;
      if(layout === "split") { wrap.querySelector('[data-wrap]').checked = true; diffs.classList.remove('nowrap'); }
      render();
    }
    if(b.hasAttribute("data-open"))onOpen(file.path);
    if(b.dataset.fold){
      const rows=diffs.querySelectorAll('tr.folded[data-fold="'+b.dataset.fold+'"]');
      const open=b.textContent==="show";rows.forEach(r=>r.hidden=!open);b.textContent=open?"hide":"show";
    }
  }
  root.addEventListener("click", action);
  controls.addEventListener("click", event => { event.stopPropagation(); action(event); });
  controls.querySelector("[data-wrap]").onchange=e=>diffs.classList.toggle("nowrap",!e.target.checked);
  render();
  return {
    nav,
    controls, wrap,
    destroy() { root.removeEventListener("click", action); controls.remove(); wrap.remove(); },
    goToLine(line) {
      const row = [...diffs.querySelectorAll("tr")].find(r => Number(r.querySelectorAll(".ln")[1]?.textContent) === line);
      row?.scrollIntoView({ block: "center" });
    },
  };
}
