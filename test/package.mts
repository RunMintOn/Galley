import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const directory = await mkdtemp(join(tmpdir(), "review-package-"));
const output = execFileSync("npm", ["pack", "--pack-destination", directory, "--json"], { encoding: "utf8" });
const packed = JSON.parse(output)[0].filename;
execFileSync("tar", ["-xzf", join(directory, packed), "-C", directory]);
const packageRoot = join(directory, "package");
const env = { ...process.env, REVIEW_CONSOLE_STATE: join(directory, "state") };
try {
  const address = execFileSync(process.execPath, [join(packageRoot, "dist/cli.mjs")], { encoding: "utf8", env, timeout: 20000 }).trim();
  const service = JSON.parse(await readFile(join(env.REVIEW_CONSOLE_STATE, "service.json"), "utf8"));
  const response = await fetch(service.origin + "/api/projects", { headers: { Authorization: `Bearer ${service.token}` } });
  assert.equal(response.status, 200);
  assert.equal((await fetch(service.origin + "/")).status, 200);
  const metrics = await (await fetch(service.origin + "/api/metrics", { headers: { Authorization: `Bearer ${service.token}` } })).json();
  const second = execFileSync(process.execPath, [join(packageRoot, "dist/cli.mjs")], { encoding: "utf8", env, timeout: 10000 }).trim();
  assert.equal(second, address);
  const stopped = execFileSync(process.execPath, [join(packageRoot, "dist/cli.mjs"), "stop"], { encoding: "utf8", env, timeout: 10000 }).trim();
  assert.match(stopped, /已停止/);
  console.log(JSON.stringify({ packagedWithoutNodeModules: true, reusesSharedService: true, metrics, directory }));
} catch (error) {
  try { execFileSync(process.execPath, [join(packageRoot, "dist/cli.mjs"), "stop"], { env, timeout: 5000 }); } catch {}
  throw error;
}
