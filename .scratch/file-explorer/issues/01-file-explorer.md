Status: ready-for-agent

# 文件树与日用文件操作

按 [规格](../spec.md) 实现文件树、文件操作与撤回、导航和状态记忆。

## 实现与验证

- 文件管理与撤回：`src/file-actions.ts`、`web-src/file-explorer.js`。
- 三处树形列表统一行高、缩进、目录图标和竖线；项目分支刷新不再先清掉已有分支行，项目按钮原位更新。
- 快速找文件、目录展开和栏折叠记忆已接入。
- `npm run test:files`：7 项通过，含隔离浏览器流程与真实系统废纸篓恢复。
- `npm run typecheck`、Go 测试通过。截图在 `test-results/file-explorer/`，已查看常规与窄窗口、右键与搜索。
- 原生 Finder/Terminal 打开和 WKWebView 快捷键未做桌面键鼠自动化验收。
- 正式桌面包构建及签名校验通过，已重新打开 `dist-desktop/Galley.app`。
- 后续截图反馈已完成：四栏整条折叠竖栏可点击、项目菜单不越界、目录去掉箭头。专门的无头浏览器快检通过，已再次重建并打开正式桌面包。
