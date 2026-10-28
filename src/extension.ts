import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ChangeTracker, type ChangeOutcome } from "./changes.ts";
import { ensureService, stateDirectory, type Service } from "./service.ts";
import { startSessionInput } from "./session-input.mjs";
import type { Round } from "./model.ts";

const ENTRY = "review-console.round.v1";
const ownership = Symbol.for("pi-review-console.capture.v1");
export default function reviewConsole(pi: ExtensionAPI) {
  const changes = new ChangeTracker();
  let service: Service | undefined;
  let input: Awaited<ReturnType<typeof startSessionInput>> | undefined;
  let round: { id: string; reply?: string; outcome: ChangeOutcome; notice?: string } | undefined;
  let capture = false;
  const post = async (path: string, body: unknown) => {
    if (!service) throw new Error("本地服务不可用");
    const response = await fetch(service.origin + "/api/" + path, {
      method: "POST", headers: { Authorization: `Bearer ${service.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error((await response.text()).slice(0, 200));
  };
  const spool = () => join(stateDirectory(), "pending");
  async function publish(saved: Round) {
    await mkdir(spool(), { recursive: true, mode: 0o700 });
    // Session entries point to a durable outbox so a service outage cannot lose a round.
    const path = join(spool(), saved.id + ".json");
    await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
    pi.appendEntry(ENTRY, { id: saved.id, path });
    await post("round", saved);
  }
  function begin(ctx: ExtensionContext) {
    if (round) return;
    round = { id: randomUUID(), outcome: "completed" };
    changes.start(ctx.cwd, Date.now());
  }
  const legacyActive = () => {
    const globals = globalThis as Record<symbol, unknown>;
    if (globals[Symbol.for("pi-compact-tool.capture-disabled.v1")]) return false;
    const compact = globals[Symbol.for("pi-compact-tool.style-selection.v1")] as { style?: string } | undefined;
    return compact !== undefined && (compact.style ?? pi.getFlag("compact-style") ?? "aggregate") !== "off";
  };
  async function connect(ctx: ExtensionContext) {
    service = await ensureService();
    input ??= await startSessionInput({ isIdle: () => ctx.isIdle(), send: text => pi.sendUserMessage(text, { expandPromptTemplates: false }) });
    await post("register", {
      cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(), file: ctx.sessionManager.getSessionFile(),
      title: ctx.sessionManager.getSessionName(), bridge: { origin: input.origin, token: input.token },
    });
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
      const data = entry.data as { path?: string };
      if (!data.path) continue;
      try { await post("round", JSON.parse(await readFile(data.path, "utf8"))); }
      catch { ctx.ui.notify("部分历史报告未恢复，可通过 /review 重试连接。", "warning"); }
    }
    return service;
  }
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    try {
      const globals = globalThis as Record<symbol, unknown>;
      capture = !legacyActive() && !globals[ownership];
      if (capture) globals[ownership] = true;
      else ctx.ui.notify("审查台未启用重复捕获：旧 compact-tool 仍在捕获。请使用隔离会话，或先 /tools off 后 /reload。", "warning");
      await connect(ctx);
    } catch (e) { ctx.ui.notify(`审查台连接失败：${e instanceof Error ? e.message : String(e)}`, "error"); }
  });
  pi.on("message_start", e => { input?.received(e.message); });
  pi.on("agent_start", (_e, ctx) => { if (service) begin(ctx); input?.update(""); });
  pi.on("message_end", (e, ctx) => {
    if (e.message.role === "user" && service) { begin(ctx); changes.userMessage(e.message); }
    if (e.message.role === "assistant" && e.message.stopReason === "error") input?.update(e.message.errorMessage);
  });
  pi.on("turn_end", e => {
    if (!round) return;
    round.reply = e.message.role === "assistant" && e.message.stopReason === "stop" && !e.message.content.some(p => p.type === "toolCall")
      ? e.messageEntryId : undefined;
  });
  pi.on("tool_execution_start", async (e, ctx) => {
    if (capture && legacyActive()) {
      capture = false; changes.reset();
      delete (globalThis as Record<symbol, unknown>)[ownership];
      ctx.ui.notify("旧 compact-tool 捕获已重新启用；审查台停止捕获，避免重复。", "warning");
    }
    if (!capture || !round) return;
    // Hooks preserve the host's tool execution and compact-tool's renderer contracts.
    if (["edit", "write"].includes(e.toolName) && typeof e.args.path === "string") {
      const path = e.args.path.replace(/^~(?=\/|$)/, homedir());
      await changes.captureBefore(resolve(ctx.cwd, path));
    }
    if (e.toolName === "apply_patch" && typeof e.args.patch === "string") await changes.capturePatchBefore(e.args.patch, ctx.cwd);
  });
  pi.on("tool_execution_end", e => { if (capture && e.toolName === "apply_patch" && e.isError) changes.patchFailed(); });
  pi.on("agent_before_settle", e => { if (round) round.outcome = e.outcome; });
  pi.on("agent_settled", async (e, ctx) => {
    input?.settled(e.aborted);
    const completed = round;
    round = undefined;
    if (!completed) return;
    try {
      const report = capture ? await changes.finish(Date.now(), completed.outcome) : undefined;
      await publish({
        id: completed.id, sessionId: ctx.sessionManager.getSessionId(), entryId: completed.reply,
        outcome: completed.outcome, report, end: Date.now(),
        notice: capture ? (report ? undefined : "本轮没有使用已追踪的写文件工具") : "旧捕获仍启用；新插件未重复捕获",
      });
    } catch (error) { ctx.ui.notify(`本轮报告未能发布，请检查本地保存与连接：${error instanceof Error ? error.message : String(error)}`, "warning"); }
  });
  pi.registerCommand("review", {
    description: "打开多项目审查台并定位当前会话",
    async handler(_args, ctx) {
      try {
        const connected = await connect(ctx);
        await post("focus", { sessionId: ctx.sessionManager.getSessionId() });
        const hash = new URLSearchParams({ token: connected.token, session: ctx.sessionManager.getSessionId(), root: ctx.cwd });
        const url = connected.origin + "/#" + hash;
        const result = await pi.exec("open", [url], { timeout: 10000 });
        if (result.code !== 0) ctx.ui.notify(url, "warning");
      } catch (e) { ctx.ui.notify(`无法打开审查台：${e instanceof Error ? e.message : String(e)}`, "error"); }
    },
  });
  pi.on("session_shutdown", async () => {
    await input?.close(); input = undefined;
    if (capture) delete (globalThis as Record<symbol, unknown>)[ownership];
    capture = false; round = undefined; changes.reset();
  });
}
