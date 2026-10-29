import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";

const run = promisify(execFile);

test("an installed app offers a source-independent command that stops only the old service on request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-recovery-"));
  const backend = join(directory, "Review Console's $App.app", "Contents/Resources/backend");
  const state = join(directory, "custom state's $data");
  const elsewhere = join(directory, "unrelated-working-directory");
  await mkdir(backend, { recursive: true });
  await mkdir(state);
  await mkdir(elsewhere);
  await build({
    entryPoints: ["src/cli.ts"], outfile: join(backend, "cli.mjs"),
    bundle: true, platform: "node", format: "esm",
    define: { __REVIEW_BUILD__: JSON.stringify("new-build") },
  });
  let stopped = false;
  const old = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/health") {
      response.end(JSON.stringify({ app: "pi-review-console", build: "old-build" }));
    } else if (request.headers.authorization !== "Bearer recovery-test") {
      response.writeHead(403).end("{}");
    } else if (request.url === "/api/shutdown" && request.method === "POST") {
      stopped = true;
      response.end("{}");
    } else {
      response.end("{}");
    }
  });
  await new Promise<void>(resolve => old.listen(0, "127.0.0.1", resolve));
  try {
    const port = (old.address() as { port: number }).port;
    await writeFile(join(state, "service.json"), JSON.stringify({
      origin: `http://127.0.0.1:${port}`, token: "recovery-test", pid: process.pid,
    }));
    let message = "";
    await assert.rejects(run(process.execPath, [join(backend, "cli.mjs"), "--json"], {
      cwd: elsewhere, env: { ...process.env, REVIEW_CONSOLE_STATE: state },
    }), (error: Error & { stderr?: string }) => {
      message = error.stderr || "";
      assert.match(message, /服务来自旧构建/);
      assert.match(message, /保存草稿/);
      assert.doesNotMatch(message, /npm run|at .*\.mjs:\d/);
      return true;
    });
    assert.equal(stopped, false, "showing recovery instructions must not stop a live service");
    const command = message.split("\n").find(line => line.startsWith("REVIEW_CONSOLE_STATE="));
    assert.ok(command, "the error must include a copyable terminal command");
    const result = await run("/bin/sh", ["-c", command], {
      cwd: elsewhere, env: { ...process.env, REVIEW_CONSOLE_STATE: join(directory, "wrong-state") },
    });
    assert.match(result.stdout, /已停止/);
    assert.equal(stopped, true);
  } finally {
    await new Promise<void>((resolve, reject) => old.close(error => error ? reject(error) : resolve()));
  }
});
