# pi-review-console

一个窗口审查多个本地项目：项目 / 文件树 / 本轮改动或 Git 历史 / 回复。

## 构建与安装

需要 macOS、Node 22.19+ 和 pi 1.4。

```sh
npm ci --legacy-peer-deps
npm run build
pi install /absolute/path/to/pi-review-console
```

这是个人级安装。已打开的每个 pi 会话都需要 `/reload`，不会因安装而自动加载。随后在 pi 中运行 `/review`，打开或唤回同一个审查台并定位当前会话。

只想单独打开文件和历史：

```sh
npm start
```

命令打印本机地址，不自动打开浏览器。页面关闭后服务与 Agent 仍可工作；文件监听会停止。服务只绑定 `127.0.0.1`，地址中的 token 是本机访问凭证，不要分享。

更新源码后重新构建。若提示服务来自旧构建：

```sh
npm run stop
npm start
```

然后 `/reload` 活跃 pi 会话。`stop` 验证服务身份和凭证，只关闭本审查台服务，不停止 Agent。

## 与旧插件共存和迁移

**不要同时启用两套改动捕获。** 检测到原版 compact-tool 时，新插件拒绝重复捕获，仍可显示回复。隔离验证时可以不加载旧插件；临时在日用会话验证则先 `/tools off` 后 `/reload`。

`migration/compact-tool-display-only.patch` 是针对已检查版本的瘦身补丁：去掉旧入口、捕获和报告保存，保留工具显示。`migration/compact-tool-display-only/index.ts` 是可审查的完整入口。补丁尚未应用到用户的旧插件。

确认新审查台可用后：

1. 检查旧仓库的未提交工作并保留备份。
2. 在旧 compact-tool 仓库先运行 `git apply --check /absolute/path/to/migration/compact-tool-display-only.patch`，再审核并应用补丁。
3. 停用旧 visual-reply 的扩展入口。其旧页面与数据不被新插件删除。
4. `/reload` 所有相关 pi 会话，确认新报告正常、工具显示仍正常。

退回旧版本时，停用新插件，再回退已审核的 compact 补丁、恢复旧 visual-reply，最后 `/reload`。不要在两套都采集时继续工作。

补丁只切断旧运行时能力，旧仓库中不再调用的页面源码和旧测试可在正式迁移验收后另行清理，避免未经确认删除日用工具。新插件运行不依赖旧目录。

## 使用

- 项目可以添加、移除和前移排序；移除不会删除磁盘文件。
- 项目有多个会话时先选择会话，再选择轮次。左右两份本轮内容一起切换；翻阅旧轮次不会被新结果打断。
- **本轮**来自 Edit / Write / apply_patch 的快照，**历史**来自 Git 提交。命令、格式化和外部编辑不自动计入本轮。
- 单文件捕获上限 1 MiB，每轮原文预算 16 MiB，沿用 compact-tool。报告保留中断、不可用和不完整提示。
- 点回复中的文件链接或独立的路径代码片段可定位文件。完整文件视图中 Markdown 默认可编辑，代码按 `e` 开启编辑。
- 文件只在手动保存时写盘，支持 `Cmd+S`。外部变化会阻止覆盖；取消冲突或导航对话框会保留当前草稿。
- 编辑上限 2 MiB；更大文件按最多 256 KiB 分段只读预览。不是全量加载后只虚拟滚动。
- Git 历史只读，包含提交、父版本比较、完整历史文件、分支引用及 blame。不执行 checkout、stage、commit 或 push。
- 回复源码仅用于临时预览，不回写 pi 会话。阅读模式下粘贴 Markdown 可临时预览；选择轮次返回。
- `‹ / ›` 或左右方向键切换轮次；`Cmd+Enter` 切换回复源码；`j/k` 跳转改动块。编辑输入时不抢占这些阅读按键。
- 输入框向选定的活会话发送原样文本。Enter 发送、Shift+Enter 换行；忙碌时不排队。未确认发送会保留草稿，不自动重发。

回复支持现有 Markdown 扩展、KaTeX、Mermaid、函数图、图表缩放拖动、代码复制及整窗深浅主题。函数图库需要编译经过白名单检查的数学表达式，因此 CSP 允许 `unsafe-eval`，仍禁止内联脚本及 iframe；Markdown 原始 HTML 关闭。

## 数据与资源

默认数据目录为 pi 配置目录下的 `review-console`。项目、轮次索引与报告存盘；回复从原会话文件按引用读取，不另建完整聊天副本。移动或删除会话文件会让对应回复不可用。

`REVIEW_CONSOLE_STATE` 可指定隔离数据目录；`REVIEW_CONSOLE_PORT` 可指定服务端口。测试均使用隔离目录，不修改个人设置或启动真实模型请求。

只监听前台活跃项目的根目录、已展开目录和当前文件所在目录。关闭或失焦停止监听；依赖和构建目录不自动展开。单个超大目录最多列出 2000 项，提交最多预览 500 个文件。

浏览器无法保证跨应用强制激活已有窗口。沿用原回复工具的标签交接机制：能确认已有页面前台显示时复用；否则新页接管，旧页释放资源并成为轻量回执。没有系统级全局热键。

## 验证

```sh
npm run check
npm run test:e2e
npm run verify:package
```

浏览器检查使用独立、无头 Google Chrome，不切换用户桌面焦点。报告与截图保留在 `test-results/`；已记录的验收结果见 `docs/verification.md`。

## 来源

快照、补丁路径解析和 diff 核心迁自 compact-tool；回复渲染、函数图、会话读取、活输入及页面交接迁自 visual-reply。依赖许可随构建保存在 `dist/THIRD-PARTY-NOTICES.txt`。
