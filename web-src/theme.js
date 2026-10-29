export function setupTheme(paperRoot, onChange = () => {}) {
  const theme = document.getElementById("theme"), paper = document.getElementById("paper");
  const apply = () => {
    const dark = localStorage.getItem("review-theme") !== "light";
    document.documentElement.classList.toggle("dark", dark);
    theme.textContent = dark ? "☀" : "☾";
    paper.replaceChildren(new Option("Charcoal", "charcoal"), new Option("Ivory", "ivory"));
    paper.value = localStorage.getItem("review-paper") === "ivory" ? "ivory" : "charcoal";
    paperRoot.dataset.paper = paper.value;
    onChange();
  };
  theme.onclick = () => { localStorage.setItem("review-theme", document.documentElement.classList.contains("dark") ? "light" : "dark"); apply(); };
  paper.onchange = () => { localStorage.setItem("review-paper", paper.value); apply(); };
  window.addEventListener("storage", e => { if (["review-theme", "review-paper"].includes(e.key)) apply(); });
  apply();
}
