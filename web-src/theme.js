const FONTS = ["system", "serif", "mono"];
const PAPER = ["charcoal", "ivory"];

export const defaultPreview = () => localStorage.getItem("review-default-preview") === "true";

export function setupPreviewPreference() {
  const input = document.getElementById("default-preview");
  if (!input) return;
  input.checked = defaultPreview();
  input.onchange = () => localStorage.setItem("review-default-preview", String(input.checked));
  window.addEventListener("storage", e => {
    if (e.key === "review-default-preview") input.checked = defaultPreview();
  });
}

export function setupTheme(paperRoot, onChange = () => {}) {
  const groups = {
    theme: [...document.querySelectorAll('[data-setting="theme"] button')],
    paper: [...document.querySelectorAll('[data-setting="paper"] button')],
    font: [...document.querySelectorAll('[data-setting="font"] button')],
  };
  const state = {
    theme: localStorage.getItem("review-theme") === "light" ? "light" : "dark",
    paper: PAPER.includes(localStorage.getItem("review-paper")) ? localStorage.getItem("review-paper") : "charcoal",
    font: FONTS.includes(localStorage.getItem("review-font")) ? localStorage.getItem("review-font") : "system",
  };
  const apply = () => {
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    document.documentElement.dataset.font = state.font;
    paperRoot.dataset.paper = state.paper;
    for (const preview of document.querySelectorAll(".file-preview")) preview.dataset.paper = state.paper;
    for (const [key, buttons] of Object.entries(groups)) {
      for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.value === state[key]));
    }
    onChange();
  };
  for (const [key, buttons] of Object.entries(groups)) {
    for (const button of buttons) {
      button.onclick = () => {
        state[key] = button.dataset.value;
        localStorage.setItem("review-" + key, state[key]);
        apply();
      };
    }
  }
  window.addEventListener("storage", e => {
    if (!["review-theme", "review-paper", "review-font"].includes(e.key)) return;
    state.theme = localStorage.getItem("review-theme") === "light" ? "light" : "dark";
    state.paper = PAPER.includes(localStorage.getItem("review-paper")) ? localStorage.getItem("review-paper") : "charcoal";
    state.font = FONTS.includes(localStorage.getItem("review-font")) ? localStorage.getItem("review-font") : "system";
    apply();
  });
  apply();
}
