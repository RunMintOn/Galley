Status: ready-for-agent
Blocked by: 01

# 02：macOS 外壳、Node 打包与服务复用

## Goal

交付可从 Finder / Dock 启动的 macOS 应用，mygo 管窗口，固定版本 Node 运行既有后台服务。

## Scope

以 [spec.md](../spec.md) 为产品与数据契约的唯一来源，尤其“执行边界与交付顺序”。本票未开始；当前仅授权文档准备，实施需用户另行授权。

## Acceptance

- [ ] 随包包含 Node 与必要服务/网页产物及许可证信息；不依赖系统 Node、开发仓库、终端 PATH 或下载后再运行的临时依赖。
- [ ] 从 Finder 启动成功；覆盖空格路径和不同工作目录，不把开发目录绝对路径写进产物。
- [ ] 复用既有状态目录、鉴权、服务发现与构建身份检查；多个窗口和重复启动不产生多份后台服务。
- [ ] 已有同构建服务可复用，不兼容构建明确提示；不自动停止旧服务或迁移个人数据。
- [ ] 关闭窗口、Cmd+Q 只影响桌面外壳，不停止 Agent 或后台服务；服务仍能接收隔离会话的后续报告。
- [ ] 记录应用体积、两窗口运行时相关进程和内存的测量方法及结果，不预设未实测预算。
- [ ] 产物验证与现有 npm 构建/打包检查相容；临时文档资产可在 08 完成后纳入最终应用。

## Implementation Notes

先读 `src/service.ts`、`src/service-protocol.mjs`、`src/cli.ts`、`scripts/build.mjs` 和 `test/package.mts`。最终双窗口交付在 09/10 验收；本任务不承担自动更新、对外签名公证或其他操作系统。

## Comments

尚未实施、未运行本票测试。
