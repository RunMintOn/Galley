import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { BUILD } from "./build.ts";

export interface Service { origin: string; token: string; pid: number }
export const stateDirectory = () => process.env.REVIEW_CONSOLE_STATE || join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi/agent"), "review-console");
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function existing(directory: string): Promise<Service | undefined> {
  try {
    const service: Service = JSON.parse(await readFile(join(directory, "service.json"), "utf8"));
    const url = new URL(service.origin);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== service.origin) return;
    const response = await fetch(service.origin + "/api/projects", {
      headers: { Authorization: `Bearer ${service.token}` }, signal: AbortSignal.timeout(1200),
    });
    if (response.ok) {
      const health = await (await fetch(service.origin + "/health", { signal: AbortSignal.timeout(1200) })).json();
      if (health.app !== "pi-review-console") return;
      if (health.build !== BUILD) {
        const error = new Error("审查台服务来自旧构建。请运行 npm run stop，再 npm start，然后 /reload。");
        error.name = "ServiceVersionError"; throw error;
      }
      return service;
    }
  } catch (e) {
    if (e instanceof Error && e.name === "ServiceVersionError") throw e;
  }
}
export async function ensureService(directory = stateDirectory()): Promise<Service> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const available = await existing(directory);
  if (available) return available;
  const lock = join(directory, "startup.lock");
  for (let attempt = 0; attempt < 120; attempt++) {
    try { await mkdir(lock); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const service = await existing(directory);
      if (service) return service;
      if (attempt === 119) throw new Error("本地服务启动锁超时，请稍后重试");
      if (Date.now() - (await stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs > 30000) {
        await rm(lock, { recursive: true, force: true });
      }
      await sleep(100);
    }
  }
  try {
    const service = await existing(directory);
    if (service) return service;
    const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
      detached: true, stdio: "ignore",
      env: { ...process.env, REVIEW_CONSOLE_STATE: directory },
    });
    let failure: Error | undefined;
    child.once("error", e => { failure = e; });
    child.unref();
    for (let attempt = 0; attempt < 80; attempt++) {
      if (failure) throw failure;
      const ready = await existing(directory);
      if (ready) return ready;
      await sleep(100);
    }
    throw new Error("本地服务未启动，请运行 npm start 检查构建");
  } finally { await rm(lock, { recursive: true, force: true }); }
}
