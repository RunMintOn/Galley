import { Chart, EvalBuiltIn } from "function-plot";
import { parsePlot } from "./plot-spec.js";

const colors = ["#407bea", "#df7830", "#2f9b82", "#b36ada", "#db5880", "#84912b", "#2e9bb8", "#9b7770"];

export function mountPlot(container, text, onError) {
  let chart;
  let observer;
  const destroy = () => {
    observer?.disconnect();
    chart?.removeAllListeners();
    container.replaceChildren();
  };
  try {
    const spec = parsePlot(text);
    const data = spec.curves.map((curve, index) => ({
      fn: curve.fn, color: colors[index], graphType: "polyline",
      sampler: "builtIn", nSamples: 1000, skipTip: true,
    }));
    // Compile before mounting so syntax/unknown-symbol errors stay inside this block.
    data.forEach((datum) => EvalBuiltIn(datum, "fn", { x: (spec.x[0] + spec.x[1]) / 2 }));
    const title = document.createElement("div");
    title.className = "plot-title";
    title.textContent = spec.title;
    title.hidden = !spec.title;
    const target = document.createElement("div");
    target.className = "plot-canvas";
    target.setAttribute("role", "img");
    target.setAttribute("aria-label", spec.title || spec.curves.map((curve) => curve.label).join(", "));
    const legend = document.createElement("ul");
    legend.className = "plot-legend";
    spec.curves.forEach((curve, index) => {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.style.backgroundColor = colors[index];
      item.append(swatch, document.createTextNode(curve.label));
      legend.append(item);
    });
    container.replaceChildren(title, target, legend);
    chart = new Chart({
      target, grid: true, disableZoom: true,
      xAxis: { domain: spec.x, label: "x" },
      yAxis: { domain: spec.y, label: "y" },
      data,
    });
    // The library has no destroy API; its global cache otherwise retains detached replies.
    delete Chart.cache[chart.id];
    let width;
    const draw = () => {
      const nextWidth = Math.max(180, Math.floor(target.clientWidth));
      if (nextWidth === width) return;
      width = nextWidth;
      chart.options.width = width;
      chart.options.height = Math.max(260, Math.min(420, width * 0.6));
      chart.build();
      // disableZoom stops rescaling, but D3's wheel handler still prevents page scrolling.
      chart.draggable.on("wheel.zoom", null);
    };
    draw();
    observer = new ResizeObserver(() => {
      try { draw(); } catch (error) {
        destroy();
        onError(error);
      }
    });
    observer.observe(target);
  } catch (error) {
    destroy();
    onError(error);
  }
  return { destroy };
}

