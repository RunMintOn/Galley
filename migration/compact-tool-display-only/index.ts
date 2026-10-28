import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { ACTIVITY_ENTRY, ActivityProjection, installActivityUI } from "./src/activity.ts";
import { createDisplayTools } from "./src/tools.ts";
import { getDisplayStyle, refreshDisplayRows, resetDisplayState, setDisplayPreferences, setDisplayStyle, type DisplayPreferences, type DisplayStyle } from "./src/state.ts";
import { loadPreferences, savePreferences } from "./src/preferences.ts";
import { displayStyles as styles, openDisplayMenu } from "./src/menu.ts";

// Reload replaces extension modules but keeps the Pi process and its globals.
const selectionKey = Symbol.for("pi-compact-tool.style-selection.v1");
const selection = (globalThis as typeof globalThis & { [selectionKey]?: { style?: DisplayStyle } })[selectionKey] ??= {};
export default function compactToolExtension(pi: ExtensionAPI): void {
  (globalThis as Record<symbol, unknown>)[Symbol.for("pi-compact-tool.capture-disabled.v1")] = true;
  for (const tool of createDisplayTools(() => pi.getSettings(), undefined, false)) {
    // Bash display is adapted at the TUI layer; leave execution to Pi or another extension.
    if (tool.name !== "bash") pi.registerTool(tool);
  }
  const activity = new ActivityProjection();
  let releaseUI: (() => void) | undefined;
  let persistedFinal: string | undefined;
  const interactive = (ctx: ExtensionContext) => ctx.hasUI && ctx.mode === "tui";
  const enabled = (ctx: ExtensionContext) => interactive(ctx) && getDisplayStyle() !== "off";
  const installUI = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;
    const outputPad = pi.getSettings().outputPad === 0 ? 0 : 1;
    releaseUI = installActivityUI(activity, () => theme, () => outputPad);
  };
  const preferencesPath = join(getAgentDir(), "extension-data", "pi-compact-tool", "preferences.json");
  const loadSavedPreferences = async (ctx: ExtensionContext) => {
    try {
      setDisplayPreferences(await loadPreferences(preferencesPath));
    } catch (error) {
      ctx.ui.notify(`无法读取展示偏好，使用默认值：${error instanceof Error ? error.message : String(error)}`, "warning");
    }
  };
  const updatePreferences = async (patch: Partial<DisplayPreferences>, ctx: ExtensionContext) => {
    try {
      setDisplayPreferences(await savePreferences(preferencesPath, patch));
    } catch (error) {
      ctx.ui.notify(`无法保存展示偏好：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };
  const rebuild = (ctx: ExtensionContext) => {
    if (!enabled(ctx)) return;
    activity.rebuild(ctx.sessionManager.buildContextEntries());
    refreshDisplayRows();
  };

  pi.registerFlag("compact-style", {
    description: "Initial tool display style: aggregate, tidy, claude or off",
    type: "string",
    default: "aggregate",
  });
  pi.registerCommand("tools", {
    description: "工具展示设置：风格、颜色、Codemode 和思考显示",
    async handler(_args, ctx) {
      if (!interactive(ctx)) return;
      if (getDisplayStyle() === "off") await loadSavedPreferences(ctx);
      await openDisplayMenu(ctx, async style => {
        if (style === "off") {
          releaseUI?.(); releaseUI = undefined;
          activity.rebuild([]);
          persistedFinal = undefined;
        }
        const wasOff = getDisplayStyle() === "off";
        selection.style = style;
        setDisplayStyle(style);
        if (wasOff && style !== "off") {
          await loadSavedPreferences(ctx);
          rebuild(ctx);
          installUI(ctx);
        }
      }, patch => updatePreferences(patch, ctx));
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    (globalThis as Record<symbol, unknown>)[Symbol.for("pi-compact-tool.capture-disabled.v1")] = true;
    releaseUI?.(); releaseUI = undefined; persistedFinal = undefined;
    const flag = pi.getFlag("compact-style");
    resetDisplayState(selection.style ?? (styles.includes(flag as DisplayStyle) ? flag as DisplayStyle : "aggregate"));
    if (!enabled(ctx)) return;
    await loadSavedPreferences(ctx);
    rebuild(ctx);
    installUI(ctx);
    if (!styles.includes(flag as DisplayStyle)) ctx.ui.notify("compact-style 只支持 aggregate、tidy、claude 或 off，已使用 aggregate。", "warning");
  });
  pi.on("agent_start", (_event, ctx) => {
    if (!enabled(ctx)) return;
    activity.agentStarted(Date.now());
  });
  pi.on("agent_end", (event, ctx) => {
    if (!enabled(ctx)) return;
    activity.agentEnded(event.messages, Date.now());
  });
  pi.on("message_update", (event, ctx) => {
    if (enabled(ctx)) activity.streamUpdated(event.message, event.assistantMessageEvent);
  });
  pi.on("message_end", (event, ctx) => {
    if (!enabled(ctx)) return;
    activity.ingest(event.message);
    if (event.message.role === "assistant") activity.completed(event.message, Date.now());
  });
  pi.on("tool_execution_start", async (event, ctx) => {
    if (!enabled(ctx)) return;
    if (!event.parentToolCallId) activity.started(event.toolCallId, Date.now());
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (!enabled(ctx)) return;
    if (!event.parentToolCallId) activity.ended(event.toolCallId, Date.now(), event.toolName === "bash" ? event.result : undefined);
  });
  pi.on("agent_settled", async (_event, ctx) => {
    if (!enabled(ctx)) return;
    activity.settled(Date.now());
    refreshDisplayRows();
    const timing = activity.timingRecord();
    if (timing.finalKey && timing.finalKey !== persistedFinal) {
      // Non-context custom data makes observed parallel/serial dispatch and wall time
      // survive reload without adding model-visible messages or altering tool results.
      pi.appendEntry(ACTIVITY_ENTRY, timing);
      persistedFinal = timing.finalKey;
    }
  });
  pi.on("session_tree", (_event, ctx) => rebuild(ctx));
  pi.on("session_compact", (_event, ctx) => rebuild(ctx));
  pi.on("session_shutdown", () => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("pi-compact-tool.capture-disabled.v1")];
    releaseUI?.(); releaseUI = undefined;
    resetDisplayState();
  });
}

