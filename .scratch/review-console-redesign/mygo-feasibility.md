# mygo 接入验证记录

## 结论

Ticket 01 已完成：mygo / WKWebView 可承接现有前端和 Node 服务，后续产品实现与联合验收也已完成。用户在最初隐藏窗口验证后，明确许可了本轮真实桌面窗口、焦点和原生按键检查。

最终记录见 [桌面验收](../../docs/redesign-verification.md)，持久化验证驱动为 `test/desktop.mts` 和 `test/desktop-entry.test.ts`。当前边界包括未逐一切换系统输入法、未覆盖所有富文本剪贴板格式，不声称完成这些人工专项检查。

## 环境与初始证据

- macOS 15.7.9 / arm64。
- 官方 Go 1.27.3 下载至 `/tmp/lite-editor-toolchain/go`，SHA-256 校验通过，未修改全局工具链或 PATH。
- mygo 固定 `v0.7.4-0.20261029110259-0cb6d05d55b7`，与 spec 文档基线一致。
- 初始探针为 `/tmp/lite-editor-toolchain/probe/main.go`；依赖、编译缓存及原始日志同样位于该临时目录。
- 真 WKWebView 加载隔离服务，使用既有 token 鉴权，显示一个测试项目与文件树，CodeMirror 挂载成功。
- `navigator.locks`、`BroadcastChannel`、`window.mygo` 可用。最终桌面使用 mygo 单实例管理窗口，不再依赖浏览器标签交接。
- 两窗口同时存在；原生 OnClose 取消后仍保留两个窗口。
- 在真实窗口中渲染 Markdown、KaTeX、Mermaid 和函数图成功；原生菜单接收到正确窗口，重复启动成功交接至首实例。

## 最终证据

`npm run test:desktop` 使用真实原生菜单和 macOS 按键验证 Cmd+T/W/1、文本输入、原生确认取消、会话定位、双窗口与后台生命周期。网页端另验证编辑、草稿保护、composition 发送保护与丰富渲染回归。

非 e2e `.app` 已通过 LaunchServices 启动；PATH 仅含系统目录时仍可启动随包 Node，退出外壳后服务存活；设置自动化变量也不产生自动化套接字。截图和结果在 `test-results/desktop/`。

## 操作偏差

初始探针准备期间，一条启动命令遗漏了隔离状态环境变量，使默认目录的服务短暂启动并写入 service.json。该命令已被工具超时终止，随后检查该进程与健康地址均已不可用。未注册会话、未运行模型请求、未停止既有 Agent，也未删除或尝试恢复个人目录文件。此偏差已向用户说明，之后所有夹具显式指定临时状态目录；最终桌面测试还使用独立应用名与内存 WebView Session。该偏差不作为任何隔离验收的成功证据。
