const originalFills = new WeakMap();
const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

function luminance(color, background) {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = background;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

// Keep authored colours unless they make the label unreadable. Restore the
// renderer's original text styles before measuring again after a theme change.
export function adjustDiagramContrast(container) {
  const background = getComputedStyle(document.body).backgroundColor;
  const groups = ".pele-node, .pele-cluster, .pele-note";
  for (const node of container.querySelectorAll(groups)) {
    const shape = [...node.children].find(child =>
      ["rect", "path", "polygon", "circle", "ellipse"].includes(child.localName) &&
      getComputedStyle(child).fill !== "none");
    if (!shape) continue;
    const fill = luminance(getComputedStyle(shape).fill, background);
    for (const text of node.querySelectorAll("text")) {
      if (text.closest(groups) !== node) continue;
      if (!originalFills.has(text)) originalFills.set(text, {
        value: text.style.getPropertyValue("fill"),
        priority: text.style.getPropertyPriority("fill"),
      });
      const original = originalFills.get(text);
      if (original.value) text.style.setProperty("fill", original.value, original.priority);
      else text.style.removeProperty("fill");
      const ink = luminance(getComputedStyle(text).fill, background);
      const ratio = (Math.max(fill, ink) + 0.05) / (Math.min(fill, ink) + 0.05);
      if (ratio < 4.5) text.style.setProperty("fill", fill > 0.179 ? "#000000" : "#ffffff");
    }
  }
}

