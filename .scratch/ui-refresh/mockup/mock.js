const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const body = document.body;
const shell = $("#shell");
const reply = $(".pane-reply");
const content = $(".pane-content");
const notes = $("#notes");
const popover = $("#settings-popover");
const gear = $("#settings-btn");

/* ── appearance ─────────────────────────────────────────────────────────── */

function setTheme(theme) {
  body.dataset.theme = theme;
  $$("#bar-theme button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeValue === theme)));
  $$('[data-setting="theme"] button').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === theme)));
}

function setPaper(paper) {
  reply.dataset.paper = paper;
  $$('[data-setting="paper"] button').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === paper)));
}

function setFont(font) {
  body.dataset.font = font;
  $$('[data-setting="font"] button').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === font)));
}

function setProjectPath(on) {
  body.dataset.projectPath = on ? "on" : "off";
  $("#path-btn").setAttribute("aria-pressed", String(on));
}

function setTypeColor(on) {
  body.dataset.typeColor = on ? "on" : "off";
  $("#type-color-btn").setAttribute("aria-pressed", String(on));
}

function setSyntax(on) {
  body.dataset.syntax = on ? "on" : "off";
  $("#syntax-btn").setAttribute("aria-pressed", String(on));
}

$$("#bar-theme button").forEach(b => b.onclick = () => setTheme(b.dataset.themeValue));

$$(".segmented[data-setting]").forEach(group => {
  group.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    const value = button.dataset.value;
    if (group.dataset.setting === "theme") setTheme(value);
    if (group.dataset.setting === "paper") setPaper(value);
    if (group.dataset.setting === "font") setFont(value);
  });
});

$("#path-btn").onclick = () => setProjectPath(body.dataset.projectPath === "off");
$("#type-color-btn").onclick = () => setTypeColor(body.dataset.typeColor !== "on");
$("#syntax-btn").onclick = () => setSyntax(body.dataset.syntax !== "on");

/* ── settings popover ──────────────────────────────────────────────────── */

function setSettings(open) {
  popover.hidden = !open;
  gear.setAttribute("aria-expanded", String(open));
}

gear.onclick = event => {
  event.stopPropagation();
  setSettings(popover.hidden);
};
document.addEventListener("click", event => {
  if (!popover.hidden && !popover.contains(event.target) && !gear.contains(event.target)) setSettings(false);
});

/* ── content modes ─────────────────────────────────────────────────────── */

const MODES = {
  review: { dir: "src/", name: "diffview.go", mono: false, counts: true, position: "1 / 3 files" },
  git: { dir: "", name: "9f7230f", mono: true, counts: false, position: "1 / 1 files" },
  source: { dir: "", name: "Reply source", mono: false, counts: false, position: "" },
};

function setMode(mode) {
  const spec = MODES[mode];
  content.dataset.mode = mode;
  $$(".content-view").forEach(view => { view.hidden = view.dataset.view !== mode; });
  $$("[data-tab]").forEach(tab => tab.setAttribute("aria-pressed", String(tab.dataset.tab === (mode === "source" ? "review" : mode))));
  $("#doc-dir").textContent = spec.dir;
  $("#doc-dir").hidden = !spec.dir;
  $("#doc-name").textContent = spec.name;
  $(".doc-name").classList.toggle("mono", spec.mono);
  $("#doc-counts").hidden = !spec.counts;
  $("#content-position").textContent = spec.position;
  $("#source-btn").setAttribute("aria-pressed", String(mode === "source"));
}

$$("[data-tab]").forEach(tab => tab.onclick = () => setMode(tab.dataset.tab));
$("#source-btn").onclick = () => setMode(content.dataset.mode === "source" ? "review" : "source");
$("[data-close-source]").onclick = () => setMode("review");

/* ── composer ─────────────────────────────────────────────────────────── */

const composer = $("#composer");
const message = $("textarea", composer);
const replyButton = $("#reply-btn");

function setComposer(open) {
  composer.hidden = !open;
  replyButton.setAttribute("aria-expanded", String(open));
  if (open) message.focus();
}

replyButton.onclick = () => setComposer(composer.hidden);
$("#send").onclick = () => { message.value = ""; setComposer(false); };

/* ── diff controls (visual only) ───────────────────────────────────────── */

$$(".doc-toolbar .segmented").forEach(group => {
  group.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    [...group.children].forEach(child => child.setAttribute("aria-pressed", String(child === button)));
  });
});

$$(".doc-toolbar .check input").forEach(input => {
  input.addEventListener("change", () => {
    const target = input.closest(".content-view").querySelector(".content-body");
    target.classList.toggle("nowrap", !input.checked);
  });
});

/* ── review notes ──────────────────────────────────────────────────────── */

function setNotes(open) {
  notes.hidden = !open;
  $("#notes-btn").setAttribute("aria-pressed", String(open));
}

$("#notes-btn").onclick = () => setNotes(notes.hidden);
$("#notes-close").onclick = () => setNotes(false);

$$("#notes li[data-target]").forEach(item => {
  const selector = item.dataset.target;
  const targets = () => selector === ".resizer" ? $$(".resizer") : $$(selector);
  const clear = () => targets().forEach(node => node.classList.remove("anno"));
  item.addEventListener("mouseenter", () => targets().forEach(node => node.classList.add("anno")));
  item.addEventListener("mouseleave", clear);
  item.addEventListener("click", () => {
    clear();
    const first = targets()[0];
    if (first) {
      first.scrollIntoView({ block: "nearest", behavior: "smooth" });
      targets().forEach(node => node.classList.add("anno"));
      setTimeout(clear, 1600);
    }
  });
});

/* ── pane resizing ─────────────────────────────────────────────────────── */

const MIN_CONTENT = 280;
const LIMITS = { projects: [140, 460], files: [160, 520], reply: [300, 760] };
let drag = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function widths() {
  return {
    projects: $(".pane-projects").getBoundingClientRect().width,
    files: $(".pane-files").getBoundingClientRect().width,
    reply: reply.getBoundingClientRect().width,
  };
}

function nextWidth(edge, start, clientX) {
  const dx = clientX - start.x;
  const rects = start.rects;
  const total = shell.getBoundingClientRect().width;
  const room = total - MIN_CONTENT;
  const [min, cap] = LIMITS[edge];
  if (edge === "projects") return clamp(rects.projects + dx, min, Math.min(cap, room - rects.files - rects.reply));
  if (edge === "files") return clamp(rects.files + dx, min, Math.min(cap, room - rects.projects - rects.reply));
  return clamp(rects.reply - dx, min, Math.min(cap, room - rects.projects - rects.files));
}

function applyWidth(edge, value) {
  shell.style.setProperty("--w-" + edge, Math.round(value) + "px");
}

function resetWidths() {
  shell.style.removeProperty("--w-projects");
  shell.style.removeProperty("--w-files");
  shell.style.removeProperty("--w-reply");
}

$$(".resizer").forEach(handle => {
  const edge = handle.dataset.edge;

  handle.addEventListener("pointerdown", event => {
    event.preventDefault();
    drag = { handle, edge, x: event.clientX, rects: widths() };
    handle.classList.add("active");
    body.classList.add("resizing");
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", event => {
    if (!drag || drag.handle !== handle) return;
    applyWidth(edge, nextWidth(edge, drag, event.clientX));
  });

  const end = event => {
    if (!drag || drag.handle !== handle) return;
    handle.classList.remove("active");
    body.classList.remove("resizing");
    drag = null;
    try { handle.releasePointerCapture(event.pointerId); } catch {}
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("dblclick", resetWidths);

  handle.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 12 : -12;
    applyWidth(edge, nextWidth(edge, { x: 0, rects: widths() }, step));
  });
});

/* ── global keys ──────────────────────────────────────────────────────── */

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  setSettings(false);
  setNotes(false);
  if (!composer.hidden) setComposer(false);
});
