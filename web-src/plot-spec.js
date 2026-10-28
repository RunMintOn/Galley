const identifiers = new Set([
  "x", "PI", "E", "sin", "cos", "tan", "asin", "acos", "atan",
  "sinh", "cosh", "tanh", "exp", "log", "sqrt", "abs", "floor", "ceil",
  "round", "min", "max", "pow",
]);

function range(value, name) {
  if (!Array.isArray(value) || value.length !== 2 ||
      !value.every(Number.isFinite) || value[0] >= value[1] ||
      !Number.isFinite(value[1] - value[0])) {
    throw new Error(`${name} must be [minimum, maximum] with finite numbers and minimum < maximum.`);
  }
  return value;
}

function label(value, name) {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  return value;
}

export function parsePlot(text) {
  const spec = JSON.parse(text);
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error("A plot block must contain a JSON object.");
  }
  if (!Array.isArray(spec.curves) || spec.curves.length < 1 || spec.curves.length > 8) {
    throw new Error("curves must contain 1–8 functions.");
  }
  return {
    title: spec.title === undefined ? "" : label(spec.title, "title"),
    x: range(spec.x ?? [-6, 6], "x"),
    y: spec.y === undefined ? undefined : range(spec.y, "y"),
    curves: spec.curves.map((curve) => {
      const fn = curve?.fn;
      // Limit input to math tokens; never pass arbitrary model-supplied code or options through.
      if (typeof fn !== "string" || !fn.trim() || fn.length > 500 ||
          /[^a-zA-Z0-9_+\-*/^().,\s]/.test(fn) ||
          (fn.replace(/\d+(?:\.\d*)?(?:[eE][+-]?\d+)?/g, "")
            .match(/[a-zA-Z_]\w*/g) || []).some((word) => !identifiers.has(word))) {
        throw new Error("fn must be a math expression in x, such as x^2 or sin(x), up to 500 characters.");
      }
      return { fn, label: curve.label === undefined ? fn : label(curve.label, "curve label") };
    }),
  };
}
