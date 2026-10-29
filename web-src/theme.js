const FONTS = [["system", "系统"], ["serif", "衬线"], ["mono", "等宽"]];

export function setupTheme(paperRoot, onChange = () => {}) {
  const theme = document.getElementById("theme"), paper = document.getElementById("paper"), font = document.getElementById("font");
  const apply = () => {
    const dark = localStorage.getItem("review-theme") !== "light";
    document.documentElement.classList.toggle("dark", dark);
    theme.textContent = dark ? "☀" : "☾";
    paper.replaceChildren(new Option("Charcoal", "charcoal"), new Option("Ivory", "ivory"));
    paper.value = localStorage.getItem("review-paper") === "ivory" ? "ivory" : "charcoal";
    paperRoot.dataset.paper = paper.value;
    // Both windows read the same key, so the prose font follows the reader
    // from the review console to the scratch window.
    const prose = localStorage.getItem("review-font") || "system";
    document.documentElement.dataset.font = FONTS.some(([value]) => value === prose) ? prose : "system";
    if (font) {
      font.replaceChildren(...FONTS.map(([value, label]) => new Option(label, value)));
      font.value = document.documentElement.dataset.font;
    }
    onChange();
  };
  theme.onclick = () => { localStorage.setItem("review-theme", document.documentElement.classList.contains("dark") ? "light" : "dark"); apply(); };
  paper.onchange = () => { localStorage.setItem("review-paper", paper.value); apply(); };
  if (font) font.onchange = () => { localStorage.setItem("review-font", font.value); apply(); };
  window.addEventListener("storage", e => { if (["review-theme", "review-paper", "review-font"].includes(e.key)) apply(); });
  apply();
}
