// Research, not a regression gate. Requires explicit desktop-operation consent.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, cp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import { startConsole } from "../../../../src/server.ts";

const exec = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const directory = await mkdtemp(join(tmpdir(), "galley-refresh-"));
const output = resolve("test-results/performance/high-refresh/creation");
await mkdir(output, { recursive: true });
const binaries = join(directory, "bin");
await mkdir(binaries);
const desktop = resolve("desktop");
const dependency = (await exec("go", ["list", "-m", "-f", "{{.Dir}}", "github.com/egoist/mygo"], { cwd: desktop })).stdout.trim();
const localMygo = join(directory, "mygo");
await cp(dependency, localMygo, { recursive: true });
const windowSource = join(localMygo, "internal/darwin/window.go");
const original = await readFile(windowSource, "utf8");
const anchor = '\tprefs := send(cfg, "preferences")\n';
assert.equal(original.split(anchor).length, 2, "重新核对升级后的 MyGo，不盲目注入研究配置");
const injection = `\t// Research only: set before WKWebView creation, in an isolated dependency copy.
\tif value := os.Getenv("PROBE_CREATE_NEAR60"); value != "" {
\t\tfeatures := send(class("WKPreferences"), "_features")
\t\tfor i, n := uintptr(0), uintptr(send(features, "count")); i < n; i++ {
\t\t\tf := send(features, "objectAtIndex:", i)
\t\t\tif goString(send(f, "key")) == "PreferPageRenderingUpdatesNear60FPSEnabled" {
\t\t\t\tsend(prefs, "_setEnabled:forFeature:", boolArg(value != "0"), uintptr(f))
\t\t\t\tlog.Printf("creation preferNear60=%s readback=%v", value, send(prefs, "_isEnabledForFeature:", uintptr(f)) != 0)
\t\t\t}
\t\t}
\t}
`;
await chmod(windowSource, 0o644);
await writeFile(windowSource, original.replace(anchor, anchor + injection));
const modfile = join(directory, "probe.mod");
await cp(join(desktop, "go.mod"), modfile);
await cp(join(desktop, "go.sum"), join(directory, "probe.sum"));
await exec("go", ["mod", "edit", `-modfile=${modfile}`, `-replace=github.com/egoist/mygo=${localMygo}`], { cwd: desktop });
const probeSource = resolve(".scratch/performance/research/refresh-probe");
await exec("go", ["build", `-modfile=${modfile}`, "-o", join(binaries, "host"), join(probeSource, "main.go")], { cwd: desktop });
await exec("swiftc", ["-O", "-parse-as-library", join(probeSource, "capture.swift"), "-o", join(binaries, "capture")]);
await exec("swiftc", ["-O", join(probeSource, "wheel.swift"), "-o", join(binaries, "wheel")]);
const root = join(directory, "repo");
await mkdir(root);
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
git("init", "-b", "main");
const source = value => Array.from({ length: 2500 }, (_, i) =>
  `export const item_${i} = calculate(${i}, "${value}", { enabled: true, label: "record-${i}" });`).join("\n") + "\n";
await writeFile(join(root, "long.ts"), source("old"));
git("add", ".");
git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Initial");
await writeFile(join(root, "long.ts"), source("new"));
const patch = join(directory, "change.patch");
await writeFile(patch, git("diff", "--no-ext-diff", "--no-color", "--", "long.ts"));
const service = await startConsole({ directory: join(directory, "state"), web: resolve("dist/web") });
const added = await fetch(service.origin + "/api/projects", {
  method: "POST", headers: { Authorization: `Bearer ${service.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ root }),
});
assert.ok(added.ok);
const front = execFileSync("osascript", ["-e", 'tell application "System Events" to get unix id of first application process whose frontmost is true'], { encoding: "utf8" }).trim();
const results = { directory, samples: [], note: "Window-only ScreenCaptureKit output changes, not physical panel scanout. rAF is reported separately." };
const children = new Set();

async function wait(fn) {
  let last;
  for (let i = 0; i < 160; i++) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(100);
  }
  throw last || Error("setup timed out");
}
function rpc(socket) {
  let buffer = "", id = 0;
  const pending = new Map();
  socket.on("data", chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const p = pending.get(message.id);
      if (p) {
        clearTimeout(p.timer); pending.delete(message.id);
        message.error ? p.reject(Error(message.error.message)) : p.resolve(message.result);
      }
    }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id;
    const timer = setTimeout(() => { pending.delete(current); reject(Error(`RPC ${method} timed out`)); }, 20000);
    pending.set(current, { resolve, reject, timer });
    socket.write(JSON.stringify({ id: current, method, params }) + "\n");
  });
}
function statistics(values) {
  const s = [...values].sort((a, b) => a - b);
  return { count: s.length, p50: s[Math.floor(s.length * .5)], p95: s[Math.floor(s.length * .95)], max: s.at(-1) };
}
function summarizeCapture(capture) {
  const rows = capture.rows;
  const from = rows[0].time + 1, to = rows[0].time + 3.5;
  const active = rows.filter(r => r.time >= from && r.time <= to);
  let hash, previous;
  const gaps = [], changes = [];
  for (const r of active) {
    if (r.hash && r.hash !== hash) {
      if (previous !== undefined) gaps.push((r.time - previous) * 1000);
      previous = r.time; hash = r.hash; changes.push(r.time);
    }
  }
  return {
    bounds: capture.bounds, callbacks: active.length, statuses: Object.fromEntries(
      [...new Set(active.map(r => r.status))].map(s => [s, active.filter(r => r.status === s).length])),
    changes: changes.length, observedChangesPerSecond: (changes.length - 1) / (changes.at(-1) - changes[0]),
    changedFrameGapsMs: statistics(gaps),
  };
}
async function host(mode, creation = "native") {
  const socketPath = join(directory, `${mode}-${creation}.sock`);
  const child = spawn(join(binaries, "host"), [], {
    env: { ...process.env, PROBE_MODE: mode, PROBE_URL: service.origin + "/#token=" + service.token,
      PROBE_PATCH: patch, PROBE_CREATE_NEAR60: creation === "high" ? "0" : "1",
      MYGO_AUTOMATION: socketPath, MYGO_FRAME_STATS: mode === "native" ? "all" : "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.add(child);
  let logs = "";
  child.stderr.on("data", chunk => { logs += chunk; });
  let socket;
  try {
    socket = await wait(() => {
      if (child.exitCode !== null) throw Error(`host exited: ${logs}`);
      return new Promise((ok, no) => {
        const s = net.createConnection(socketPath); s.once("connect", () => ok(s)); s.once("error", no);
      });
    });
    const call = rpc(socket);
    const window = await wait(async () => (await call("windows")).windows[0]);
    const evaluate = async script => (await call("eval", { window: window.id, script })).value;
    const menu = label => call("menu", { window: window.id, path: ["Probe", label] });
    execFileSync("osascript", ["-e", `tell application "System Events" to tell (first application process whose unix id is ${child.pid}) to set frontmost to true`]);
    if (mode !== "native") {
      try {
        await wait(() => evaluate("!!window.reviewDesktop && !document.body.classList.contains('booting')"));
      } catch (error) {
        console.error("boot diagnostic", await evaluate("({ready:document.readyState,boot:document.querySelector('#boot-message')?.textContent,bridge:!!window.mygo,desktop:!!window.reviewDesktop,body:document.body?.className})"));
        throw error;
      }
      await wait(() => evaluate("!!document.querySelector('#projects .project[aria-current=\"true\"]')"));
      await evaluate("document.querySelector('#history-tab').click()");
      await wait(() => evaluate("!!document.querySelector('.commit-card')"));
      await evaluate(`document.querySelector('.workspace-file[data-path="long.ts"]').click()`);
      await wait(() => evaluate("document.querySelectorAll('#content table.diff tr').length === 5000"));
    } else await call("idle", { window: window.id, timeout: 15000 });
    const screenshot = await call("capture", { window: window.id });
    await writeFile(join(output, `${mode}-${creation}.png`), Buffer.from(screenshot.png, "base64"));
    const cases = mode === "native" ? [[`native-${creation}`, null, false]] : [
      [`diff-${creation}`, creation !== "high", false],
      [`minimal-${creation}`, creation !== "high", false],
      [`animation-${creation}`, creation !== "high", true],
    ];
    for (const [name, near60, animate] of cases) {
      if (name.startsWith("minimal-")) {
        await menu("Minimal");
        await wait(() => evaluate("document.querySelector('#marker') !== null"));
      }
      if (mode !== "native") {
        await menu(near60 ? "Near60 On" : "Near60 Off");
        await evaluate(`(async () => {
          const c = document.querySelector('#content'); c.scrollTop = 0;
          await document.fonts.ready;
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const p = window.refreshProbe = { frames: [], positions: [], start: performance.now(), added: 0, removed: 0 };
          p.observer = new MutationObserver(rs => { for (const r of rs) { p.added += r.addedNodes.length; p.removed += r.removedNodes.length; } });
          p.observer.observe(c, { childList: true, subtree: true });
          let previous, frame = 0;
          const marker = document.querySelector('#marker');
          if (marker) marker.style.display = ${animate} ? 'block' : 'none';
          const tick = now => {
            if (previous !== undefined) p.frames.push(now - previous);
            previous = now; p.positions.push(c.scrollTop);
            if (${animate} && marker) { marker.textContent = String(++frame); marker.style.backgroundColor = 'rgb(' + (frame % 256) + ',80,130)'; }
            p.raf = requestAnimationFrame(tick);
          };
          p.raf = requestAnimationFrame(tick);
        })()`);
      }
      await sleep(200);
      const windows = (await call("windows")).windows;
      const w = windows[0];
      const rect = mode === "native" ? { x: 459, y: 40, width: 510, height: w.contentBounds.height - 40 } :
        await evaluate("(() => {const r = document.querySelector('#content').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
      const point = { x: w.contentBounds.x + rect.x + rect.width / 2, y: w.contentBounds.y + rect.y + rect.height / 2 };
      let input;
      const capturePromise = new Promise((ok, no) => {
        const roi = [rect.x, rect.y + w.contentBounds.y - w.bounds.y, rect.width, rect.height];
        const proc = spawn(join(binaries, "capture"), [String(child.pid), "5", ...roi.map(String)]);
        children.add(proc);
        let data = "", err = "", wheel;
        proc.stdout.on("data", chunk => {
          data += chunk;
          if (data.includes("READY\n") && !wheel) {
            wheel = animate ? Promise.resolve() : sleep(250).then(() =>
              exec(join(binaries, "wheel"), [String(point.x), String(point.y)], { timeout: 15000 })
                .then(result => { input = JSON.parse(result.stdout); }));
            wheel.catch(no);
          }
        });
        proc.stderr.on("data", chunk => { err += chunk; });
        proc.on("error", no);
        proc.on("exit", async code => {
          children.delete(proc);
          if (code !== 0) { no(Error(`capture: ${code} ${err}`)); return; }
          try { await wheel; ok(JSON.parse(data.trim().split("\n").at(-1))); } catch (error) { no(error); }
        });
      });
      const capture = await capturePromise;
      const sample = { name, near60, point, windowBounds: w.bounds, contentRect: rect, capture: summarizeCapture(capture) };
      if (input) {
        const gaps = input.times.slice(1).map((t, i) => (t - input.times[i]) * 1000);
        sample.input = { events: input.times.length, hz: 479 / (input.times.at(-1) - input.times[0]), gapsMs: statistics(gaps) };
        await writeFile(join(output, `${name}-input.json`), JSON.stringify(input, null, 2));
        assert.ok(sample.input.hz > 118 && sample.input.hz < 122, "输入必须实际接近 120 次/秒");
      }
      if (mode !== "native") sample.page = await evaluate(`(() => {
        const p=refreshProbe; cancelAnimationFrame(p.raf); p.observer.disconnect();
        return {frames:p.frames, maxScroll:Math.max(...p.positions),end:document.querySelector('#content').scrollTop,added:p.added,removed:p.removed};
      })()`);
      if (sample.page) { sample.page.frameGapsMs = statistics(sample.page.frames); delete sample.page.frames; }
      results.samples.push(sample);
      await writeFile(join(output, `${name}.json`), JSON.stringify(capture, null, 2));
      await writeFile(join(output, "summary.json"), JSON.stringify(results, null, 2));
      console.log(JSON.stringify(sample));
      if (sample.page && !animate) {
        assert.ok(sample.page.maxScroll > 5800 && sample.page.end < 10, "必须实际往返滚动，不以静止画面作对照");
        assert.equal(sample.page.added + sample.page.removed, 0, "测量过程中不应重建内容");
      }
    }
    await menu("Quit");
    await wait(() => child.exitCode !== null);
  } finally {
    socket?.destroy();
    if (child.exitCode === null) child.kill("SIGTERM");
    children.delete(child);
    await writeFile(join(output, `${mode}-${creation}-host.log`), logs);
  }
}
try {
  await host("web", "default");
  await host("web", "high");
  await host("web", "repeat");
  await host("native", "one");
  await host("native", "two");
} finally {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  await service.close();
  await writeFile(join(output, "summary.json"), JSON.stringify(results, null, 2));
  execFileSync("osascript", ["-e", `tell application "System Events" to tell (first application process whose unix id is ${front}) to set frontmost to true`]);
}
