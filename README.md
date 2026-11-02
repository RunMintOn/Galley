# Galley

一个窗口审查多个本地项目：项目 / 文件树 / 本轮改动或 Git 历史 / 回复。

## macOS 桌面应用

本轮提供 mygo 系统 WKWebView 外壳：四栏审查台与独立 Markdown 编辑窗口，共用现有本地服务。应用不内置 Node，运行需要本机已有 Node ≥22.19.0（可复用 pi 自带运行时），不需要 Go；业务后端仍为现有 JavaScript，不是 Go 重写。

源码构建需要 Go（最低版本见 `desktop/go.mod`）、Node（版本见 `.node-version`）及本仓库 npm 依赖。首次准备环境、测试和安全更新流程见 [开发与交接](docs/development.md)。

```sh
npm ci
npm run build:desktop
open "dist-desktop/Galley.app"
```

Go 使用 PATH 中的正常安装，不依赖临时工具链。构建包含网页层，产物为本机签名的 `.app`，不是已公证的公众发行包。无需安装 mygo CLI。正在使用中的应用会阻止覆盖，请按开发文档正常退出并停止旧服务后更新。

`/review` 优先寻找 `REVIEW_CONSOLE_APP` 指定位置、`~/Applications/Galley.app`、`/Applications/Galley.app`，再找仓库构建产物；找到后启动或唤回桌面审查台，未安装时保留浏览器入口。配置 `REVIEW_CONSOLE_APP` 时须给完整 `.app` 路径。

`/review` 会把 pi 正在使用的 Node 路径传给桌面应用。独立启动时，应用自动查找 PATH 和常见安装位置；可用 `REVIEW_CONSOLE_NODE` 指定 Node 可执行文件的绝对路径。显式指定的 Node 无效或过旧时会直接报错，不自动改用其他版本。错误框会说明安装、更新或取消错误配置的方法；“复制信息并退出”可保留完整诊断。Finder 的环境配置与完整查找顺序见 [开发与交接](docs/development.md#node-查找与配置)。

只安装 `.app` 的用户遇到“服务来自旧构建”时，按错误信息保存草稿并正常退出，再在终端执行其中的停止命令，随后重新打开应用。该命令使用已安装的 Node 和后端，不需要源码目录；不会终止 pi Agent 或删除数据。

- 从第二栏底部或 File 菜单打开 Markdown 编辑窗口，可与审查台同时使用。
- 支持源码 / 分栏 / 预览、临时文本 Diff、多标签与横纵排列；`Cmd+T` 新建 Markdown，`Cmd+Shift+T` 新建 Diff，`Cmd+W` 关闭标签，`Cmd+1…9` 切换。
- `Cmd+O` 使用系统面板打开 Markdown；`Cmd+S` 保存，未命名文档首次弹出保存位置；`Cmd+Shift+S` 另存为。标签圆点标记未保存修改，关闭时可选择保存、不保存或取消。
- Finder 右键“打开方式”可以选择 Galley。设为默认：选中 `.md` → 显示简介 → 打开方式 → Galley → 全部更改。应用不会自动抢占默认关联。
- 可粘贴剪贴板中的图片并立即预览。未保存时暂存在内存，保存时写入 `<文件名>.assets/` 并使用相对引用。已有 Markdown 支持相对路径与 HTTP(S) 图片；另存为到其他目录会调整已有图片引用，不移动原图。
- 外部修改：未编辑的文件自动刷新；有本地草稿时保留草稿并提示，保存前确认是否覆盖。“重新载入”可放弃草稿读取磁盘版本。
- Markdown 与 Diff 源码使用 CodeMirror，提供行号、软换行、撤销、查找替换（`Cmd+F` / `Cmd+Option+F`）；折行不新增行号，切换标签与视图保留光标和撤销历史。
- 编辑窗口的预览与回复栏同一套渲染：公式、Mermaid、函数图都会渲染，原始 HTML 仍不执行。
- 正文默认系统字体，可在回复栏或编辑窗口切换系统 / 衬线 / 等宽，两个窗口共用同一选择。
- 添加目录使用系统选择面板；`Cmd +`、`Cmd -`、`Cmd 0` 放大、缩小、复位当前窗口。
- 未保存文档和图片不自动恢复。临时 Diff 不写盘，关闭前确认丢弃。
- 关窗及 `Cmd+Q` 不停止后台服务或 Agent；停止服务仍使用下文 `npm run stop`。
- 项目徽章表示所选会话最新轮次改动文件数，不是未读；Git 工作区分别比较 HEAD → index、index → working tree，未跟踪文本按新增。
- 审查台文件树打开 Markdown 后，可在第三栏切换源码 / 分栏 / 预览，不影响右侧 Agent 回复。文件标题旁的预览设置菜单与编辑窗口的“默认预览”开关共用同一偏好。
- 拖动第三、四栏分界可调整回复栏宽度并记住结果；双击恢复默认，也可聚焦分界后用左右方向键调整。

第二轮验证与限制见 [桌面验收记录](docs/redesign-verification.md)。

## 构建与安装

需要 macOS、Node 22.19+ 和 pi 1.4。

```sh
npm ci
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
- 点右栏 `Show source` 或按 `Cmd+Enter`，第三栏切换为当前回复的 Markdown 原文，第四栏继续预览。再次点击返回此前文件、diff 或历史；原有文件草稿保留。原文仅临时预览，不写入文件、不回写 pi 会话，不包含多 Tab 编辑模式。
- 阅读模式下粘贴 Markdown 可临时预览；回到最新或选择轮次恢复会话回复。
- `‹ / ›` 或左右方向键切换轮次；`Cmd+Enter` 切换回复源码；`j/k` 跳转改动块。编辑输入时不抢占这些阅读按键。
- 输入框向选定的活会话发送原样文本。Enter 发送、Shift+Enter 换行；忙碌时不排队。未确认发送会保留草稿，不自动重发。

回复支持现有 Markdown 扩展、KaTeX、Mermaid、函数图、图表缩放拖动、代码复制及整窗深浅主题。函数图库需要编译经过白名单检查的数学表达式，因此 CSP 允许 `unsafe-eval`，仍禁止内联脚本及 iframe；Markdown 原始 HTML 关闭。

## 数据与资源

默认数据目录为 pi 配置目录下的 `review-console`。项目、轮次索引与报告存盘；回复从原会话文件按引用读取，不另建完整聊天副本。移动或删除会话文件会让对应回复不可用。

`REVIEW_CONSOLE_STATE` 可指定隔离数据目录；`REVIEW_CONSOLE_PORT` 可指定服务端口。测试均使用隔离目录，不修改个人设置或启动真实模型请求。

只监听前台活跃项目的根目录、已展开目录和当前文件所在目录。关闭或失焦停止监听；依赖和构建目录不自动展开。单个超大目录最多列出 2000 项，提交最多预览 500 个文件。

浏览器无法保证跨应用强制激活已有窗口。沿用原回复工具的标签交接机制：能确认已有页面前台显示时复用；否则新页接管，旧页释放资源并成为轻量回执。没有系统级全局热键。

## 验证

当前完整命令和桌面测试授权、输入法检查见 [开发与交接](docs/development.md)。桌面测试自动构建独立测试包，不覆盖日用应用。

```sh
npm run check
npm run test:e2e
npm run test:visual
npm run verify:package
npm run verify:migration -- /path/to/22-pi-compact-tool
```

浏览器检查使用独立、无头 Google Chrome，不切换用户桌面焦点。报告与截图保留在 `test-results/`；已记录的验收结果见 `docs/verification.md`。

## 来源

快照、补丁路径解析和 diff 核心迁自 compact-tool；回复渲染、函数图、会话读取、活输入及页面交接迁自 visual-reply。依赖许可随构建保存在 `dist/THIRD-PARTY-NOTICES.txt`。

## 许可证

[MIT](LICENSE)。第三方依赖各自的许可随构建保存在 `dist/THIRD-PARTY-NOTICES.txt`。
