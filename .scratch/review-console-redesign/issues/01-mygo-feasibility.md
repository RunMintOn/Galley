Status: ready-for-agent
Blocked by: 无

# 01：验证 mygo / WKWebView 接入

## Goal

验证 macOS 系统 WebView 能承接现有网页与 Node 服务，并确定最小桌面测试方式。这是后续实现的前置验证，不是重写应用。

## Scope

以 [spec.md](../spec.md) 为产品与数据契约的唯一来源，尤其“执行边界与交付顺序”。本票未开始；当前仅授权文档准备，实施需用户另行授权。

## Acceptance

- [ ] 获得后续实施授权后，核对 mygo 当前要求与本机工具链；安装或更新全局工具前说明具体改动。固定验证版本并记录。
- [ ] 在隔离状态目录运行现有 Node 服务，以真实 WKWebView 加载现有界面；验证鉴权、HTTP、WebSocket、CSP、页面存储、BroadcastChannel / navigator.locks 或明确替代路径。
- [ ] 验证两个独立窗口共存，不被现有单页交接逻辑互相替换；原生菜单可把命令派发给聚焦窗口，原生关闭可取消。
- [ ] 验证 CodeMirror 编辑、中文输入、复制粘贴、Markdown、公式和图表的关键路径；分别记录“已有能力可复用”和“需要适配”。
- [ ] 验证单实例启动/唤回及携带隔离会话定位参数的最小交接，不接入真实日用会话。
- [ ] 选定可复现的 WKWebView 验证方式；说明自动化范围和仍需人工实机检查的部分。
- [ ] 留下运行命令、固定版本、隔离数据位置、截图/日志和逐项结果；若关键能力不通，停止后续 Ticket 并向用户报告，不自行更换路线。

## Implementation Notes

重点阅读 `src/service.ts`、`src/server.ts`、`web-src/bootstrap.js`、`web-src/app.js`、`web-src/editor.js` 和规格中的固定版本官方文档。现阶段仅查过文档，本机 PATH 未找到 Go，尚未安装、运行或验证 mygo。此 Ticket 的技术原型也属于代码工作，当前不得开始。

## Comments

尚未实施、未运行本票测试。
