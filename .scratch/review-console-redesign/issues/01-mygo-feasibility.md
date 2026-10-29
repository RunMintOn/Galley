Status: ready-for-agent
Blocked by: 无

# 01：验证 mygo / WKWebView 接入

## Goal

验证 macOS 系统 WebView 能承接现有网页与 Node 服务，并确定最小桌面测试方式。这是后续实现的前置验证，不是重写应用。

## Scope

以 [spec.md](../spec.md) 为产品与数据契约的唯一来源，尤其“执行边界与交付顺序”。用户已授权全部实施。本票正在进行；当前在真实桌面交互许可前暂停，依赖任务尚未开始。

## Acceptance

- [x] 获得实施授权后核对工具链；Go 1.27.3 校验后仅解压至 /tmp，mygo 固定到规格基线版本，未修改全局安装。
- [ ] 在隔离状态目录运行现有 Node 服务，以真实 WKWebView 加载现有界面；验证鉴权、HTTP、WebSocket、CSP、页面存储、BroadcastChannel / navigator.locks 或明确替代路径。
- [ ] 验证两个独立窗口共存，不被现有单页交接逻辑互相替换；原生菜单可把命令派发给聚焦窗口，原生关闭可取消。
- [ ] 验证 CodeMirror 编辑、中文输入、复制粘贴、Markdown、公式和图表的关键路径；分别记录“已有能力可复用”和“需要适配”。
- [ ] 验证单实例启动/唤回及携带隔离会话定位参数的最小交接，不接入真实日用会话。
- [ ] 选定可复现的 WKWebView 验证方式；说明自动化范围和仍需人工实机检查的部分。
- [ ] 留下运行命令、固定版本、隔离数据位置、截图/日志和逐项结果；若关键能力不通，停止后续 Ticket 并向用户报告，不自行更换路线。

## Implementation Notes

重点阅读 `src/service.ts`、`src/server.ts`、`web-src/bootstrap.js`、`web-src/app.js`、`web-src/editor.js` 和规格中的固定版本官方文档。Go 与隐藏窗口探针已在 /tmp 构建运行，部分接入验证通过；完整证据及未测项见 [接入记录](../mygo-feasibility.md)。

## Comments

已完成隐藏 WKWebView 的鉴权/文件树/编辑器挂载与原生关闭拦截最小验证。尚缺真实菜单、快捷键、输入及会话唤回证据，不标完成。申请一次桌面交互许可后继续本票。
