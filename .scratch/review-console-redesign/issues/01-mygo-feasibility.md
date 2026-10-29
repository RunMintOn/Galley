Status: ready-for-agent
Resolution: resolved
Blocked by: 无

# 01：验证 mygo / WKWebView 接入

## Goal

验证 macOS 系统 WebView 能承接现有网页与 Node 服务，并确定最小桌面测试方式。这是后续实现的前置验证，不是重写应用。

## Scope

以 [spec.md](../spec.md) 为产品与数据契约来源。本票实现已完成；验收证据和未专项验证的边界见 Comments。

## Acceptance

- [x] 获得实施授权后核对工具链；Go 1.27.3 校验后仅解压至 /tmp，mygo 固定到规格基线版本，未修改全局安装。
- [x] 在隔离状态目录运行现有 Node 服务，以真实 WKWebView 加载现有界面；验证鉴权、HTTP、WebSocket、CSP、页面存储、BroadcastChannel / navigator.locks 或明确替代路径。
- [x] 验证两个独立窗口共存，不被现有单页交接逻辑互相替换；原生菜单可把命令派发给聚焦窗口，原生关闭可取消。
- [x] 核对 CodeMirror、中文文本、系统编辑菜单与丰富渲染的兼容性；代表性路径已实测，未专项实测的系统输入法和跨应用剪贴板在验收记录单列。
- [x] 验证单实例启动/唤回及携带隔离会话定位参数的最小交接，不接入真实日用会话。
- [x] 选定可复现的 WKWebView 验证方式；说明自动化范围和仍需人工实机检查的部分。
- [x] 留下运行命令、固定版本、隔离数据位置、截图/日志和逐项结果；若关键能力不通，停止后续 Ticket 并向用户报告，不自行更换路线。

## Implementation Notes

重点阅读 `src/service.ts`、`src/server.ts`、`web-src/bootstrap.js`、`web-src/app.js`、`web-src/editor.js` 和规格中的固定版本官方文档。Go、初始探针和完整桌面接入已验证；证据与未专项验证的边界见 [接入记录](../mygo-feasibility.md)。

## Comments

Resolved：

mygo 固定版本与 Go 工具链已验证；真 WKWebView 的鉴权、渲染、编辑器、双窗口、原生菜单/关闭拦截、单实例可用。用户随后许可可见窗口与键盘测试；最终驱动为 test/desktop.mts。系统输入法切换和跨应用剪贴板未专项实测，保留原生实现，不声称运行过这些检查。

共同证据：[桌面验收记录](../../../docs/redesign-verification.md)。检查项表示交付工作已处理；运行验证的具体范围以记录为准，不据此声称所有输入法、剪贴板格式或大型仓库已逐一实测。
