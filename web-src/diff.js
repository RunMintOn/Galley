import * as Diff from "diff";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { goLanguage } from "@codemirror/lang-go";

const highlight = tagHighlighter([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], class: "tk-k" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName, tags.attributeName], class: "tk-t" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], class: "tk-f" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal], class: "tk-n" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character, tags.monospace], class: "tk-s" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: "tk-c" },
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6, tags.strong], class: "tk-k" },
  { tag: [tags.emphasis, tags.link, tags.url], class: "tk-f" },
  { tag: [tags.meta, tags.processingInstruction], class: "tk-c" },
]);

const parsers = new Map();
const escape = text => text.replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
function parserFor(path) {
  const ext = path.split(".").at(-1).toLowerCase();
  const language = { js: "js", mjs: "js", cjs: "js", jsx: "jsx", ts: "ts", tsx: "tsx", md: "md", markdown: "md", mdx: "md", go: "go" }[ext];
  if (!language) return null;
  if (!parsers.has(language)) {
    parsers.set(language, language === "go" ? goLanguage.parser
      : language === "md" ? markdownLanguage.parser
      : language === "js" ? javascriptLanguage.parser
      : javascript({ typescript: language === "ts" || language === "tsx", jsx: language === "jsx" || language === "tsx" }).language.parser);
  }
  return parsers.get(language);
}

function tokenize(text, parser) {
  if (!parser) return [];
  const tokens = [];
  try {
    highlightTree(parser.parse(text), highlight, (from, to, classes) => {
      if (to > from) tokens.push({ from, to, classes });
    });
  } catch {
    // An unparseable line stays plain instead of dropping the diff.
  }
  return tokens;
}

function wordRanges(before, after) {
  const oldRanges = [], newRanges = [];
  let oldAt = 0, newAt = 0;
  for (const part of Diff.diffWordsWithSpace(before, after)) {
    const length = part.value.length;
    if (part.removed) {
      oldRanges.push({ from: oldAt, to: oldAt + length, classes: "hl-d" });
      oldAt += length;
    } else if (part.added) {
      newRanges.push({ from: newAt, to: newAt + length, classes: "hl-i" });
      newAt += length;
    } else {
      oldAt += length; newAt += length;
    }
  }
  return { oldRanges, newRanges };
}

// Token and word spans can cross each other. Split at every boundary and nest
// the word marker inside the token span so both stay valid HTML.
function lineHTML(text, tokens, marks) {
  const points = new Set([0, text.length]);
  for (const token of tokens) { points.add(token.from); points.add(token.to); }
  for (const mark of marks) { points.add(mark.from); points.add(mark.to); }
  const ordered = [...points].filter(n => n >= 0 && n <= text.length).sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i], to = ordered[i + 1];
    if (to <= from) continue;
    let chunk = escape(text.slice(from, to));
    const mark = marks.find(item => item.from <= from && item.to >= to);
    if (mark) chunk = `<i class="${mark.classes}">${chunk}</i>`;
    const token = tokens.find(item => item.from <= from && item.to >= to);
    if (token) chunk = `<span class="${token.classes}">${chunk}</span>`;
    html += chunk;
  }
  return html;
}

// Rendering core migrated from compact-tool; the container owns all listeners.
export function mountDiff(root, file, onOpen, { initialLayout = "unified", toolbar, hideHead = false } = {}) {
  let layout = initialLayout;
  let hunkId = 0, foldId = 0;
  const parser = parserFor(file.path);
  // src/diff.ts already stripped the +/-/space marker, so content is the raw line.
  const lineText = line => line.content ?? "";
  const tokenCache = new Map();
  const tokensFor = text => {
    if (!parser) return [];
    if (!tokenCache.has(text)) tokenCache.set(text, tokenize(text, parser));
    return tokenCache.get(text);
  };

  // Pair each run of deletions with the insertions that replaced it. One pair
  // feeds both layouts: unified prints the two sides on separate rows, split
  // prints them side by side, and only the changed words get marked.
  function pairs(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== "delete") {
        const line = lines[i];
        const side = { number: line.type === "insert" ? line.newNumber : line.oldNumber, html: lineHTML(lineText(line), tokensFor(lineText(line)), []) };
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
          const beforeText = lineText(before), afterText = lineText(after);
          const { oldRanges, newRanges } = wordRanges(beforeText, afterText);
          out.push({
            type: "change",
            old: { number: before.oldNumber, html: lineHTML(beforeText, tokensFor(beforeText), oldRanges) },
            next: { number: after.newNumber, html: lineHTML(afterText, tokensFor(afterText), newRanges) },
          });
        } else if (before) {
          out.push({ type: "delete", old: { number: before.oldNumber, html: lineHTML(lineText(before), tokensFor(lineText(before)), []) }, next: null });
        } else {
          out.push({ type: "insert", old: null, next: { number: after.newNumber, html: lineHTML(lineText(after), tokensFor(lineText(after)), []) } });
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
  // A fold spans the whole row, so the span has to follow the active layout:
  // unified has four columns, split has five.
  const foldColumns = () => (layout === "split" ? 5 : 4);
  const foldHTML = (hidden, id) =>
    `<tr class="fold"><td colspan="${foldColumns()}"><div><span>${hidden} unchanged line${hidden === 1 ? "" : "s"}</span>` +
    `<span class="rule"></span><button type="button" data-fold="${id}">Show</button></div></td></tr>`;
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
      `<span class="h">${escape(range)}</span>` +
      `<span class="count">${changes} change${changes === 1 ? "" : "s"}</span></div>` +
      `<div class="scroll"><table class="diff"><tbody>${body}</tbody></table></div>`;
  }

  const controls = document.createElement("div");
  controls.className = "diff-toolbar";
  controls.innerHTML = '<div class="segmented" role="group" aria-label="Diff layout"><button type="button" data-layout="unified">Unified</button><button type="button" data-layout="split">Split</button></div>' +
    '<label class="check"><input type="checkbox" data-wrap checked><span class="box"></span>Wrap</label>' +
    '<span class="spacer"></span>' +
    '<button type="button" class="icon-btn" data-open aria-label="Open file" title="Open file"><svg class="icon"><use href="#i-external"/></svg></button>';
  const toolbarRoot = toolbar || root;
  toolbarRoot.append(controls);
  if (toolbarRoot !== root) toolbarRoot.hidden = false;
  const diffs = document.createElement("div");
  diffs.className = "diffs";
  root.append(diffs);
  let hunk = -1;
  function render() {
    hunkId = 0; foldId = 0;
    diffs.dataset.layout = layout;
    diffs.replaceChildren();
    if (!hideHead && !root.classList.contains("round-diff")) {
      const heading = document.createElement("div");
      heading.className = "file-head";
      heading.textContent = file.path + " · " + file.status + (file.status === "Unavailable" || file.countable === false ? " · line counts unavailable" : "  +" + file.added + " −" + file.deleted);
      diffs.append(heading);
    }
    if (file.diff?.blocks.length) diffs.insertAdjacentHTML("beforeend", file.diff.blocks.map((block, index, blocks) => {
      const previous = blocks[index - 1];
      const hidden = previous ? block.oldStartLine - previous.oldStartLine - previous.oldLineCount : 0;
      return (hidden > 0 ? `<div class="hunk-gap">${hidden} unchanged line${hidden === 1 ? "" : "s"}</div>` : "") + hunkHTML(block);
    }).join(""));
    else {
      const notice = document.createElement("p");
      notice.className = "notice";
      notice.textContent = file.notice || "No textual changes";
      diffs.append(notice);
    }
    controls.querySelectorAll("[data-layout]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layout === layout)));
  }
  const nav = (step) => {
    const hunks = [...diffs.querySelectorAll(".hunk")];
    hunk = Math.max(0, Math.min(hunks.length - 1, hunk + step));
    hunks[hunk]?.scrollIntoView({ block: "start" });
  };
  function action(event) {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.layout) {
      layout = b.dataset.layout;
      if (layout === "split") { controls.querySelector("[data-wrap]").checked = true; diffs.classList.remove("nowrap"); }
      render();
    }
    if (b.hasAttribute("data-open") && onOpen) onOpen(file.path);
    if (b.dataset.fold) {
      const rows = diffs.querySelectorAll('tr.folded[data-fold="' + b.dataset.fold + '"]');
      const open = b.textContent === "Show";
      rows.forEach(row => row.hidden = !open);
      b.textContent = open ? "Hide" : "Show";
    }
  }
  root.addEventListener("click", action);
  controls.addEventListener("click", action);
  controls.querySelector("[data-wrap]").onchange = event => diffs.classList.toggle("nowrap", !event.target.checked);
  render();
  return {
    nav,
    controls,
    destroy() { root.removeEventListener("click", action); controls.removeEventListener("click", action); controls.remove(); },
    goToLine(line) {
      const row = [...diffs.querySelectorAll("tr")].find(r => Number(r.querySelectorAll(".ln")[1]?.textContent) === line);
      row?.scrollIntoView({ block: "center" });
    },
  };
}
