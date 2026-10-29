import { ensureService, stateDirectory } from "./service.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
if (process.argv[2] === "stop") {
  const service = JSON.parse(await readFile(join(stateDirectory(), "service.json"), "utf8"));
  const origin = new URL(service.origin);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.origin !== service.origin) throw new Error("服务地址无效");
  const health = await (await fetch(origin + "health", { signal: AbortSignal.timeout(1500) })).json();
  if (health.app !== "pi-review-console") throw new Error("地址不是审查台，未停止");
  const result = await fetch(origin + "api/shutdown", { method: "POST", headers: { Authorization: `Bearer ${service.token}` }, signal: AbortSignal.timeout(1500) });
  if (!result.ok) throw new Error("服务身份验证失败，未停止");
  console.log("审查台服务已停止");
} else {
  try {
    const service = await ensureService();
    console.log(process.argv[2] === "--json" ? JSON.stringify(service) : `${service.origin}/#token=${service.token}`);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "ServiceVersionError") throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
