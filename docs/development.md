# 开发与交接

这是当前开发流程。功能和已关闭任务见 `.scratch/review-console-polish/issues/`；历史验收证据见 `redesign-verification.md`。新会话从本文件和 `git status` 开始，不依赖以前的聊天、个人记忆或 `/tmp` 里的文件。

## 环境准备

桌面构建仅支持 macOS。需要 Xcode Command Line Tools、Go、Node；浏览器测试使用 Google Chrome。

```sh
xcode-select -p
brew install go fnm
fnm install
fnm use
npm ci
```

- Node 版本以根目录 `.node-version` 为准。fnm 启用 `--use-on-cd` 后，进入项目会自动选择该版本，不改变其他项目的默认版本。
- Go 最低版本以 `desktop/go.mod` 为准。使用 PATH 中正常安装的 `go`，默认模块和构建缓存由 Go 管理；不需要 `GO_BINARY`、`GOPATH`、`GOMODCACHE` 或 `GOCACHE` 覆盖。
- 直接运行 `npm ci`，不需要额外参数或本地 npm 配置。
- `package.json` 的 undici override 修复 pi 1.4.0 开发依赖固定版本的已知漏洞，不修改全局 pi。后续升级 pi 时结合 `npm audit` 检查是否仍需要该覆盖。
- 若 `xcode-select -p` 失败，用 `xcode-select --install` 安装系统编译工具。Chrome 缺失时安装 Google Chrome 后再运行浏览器测试。
- 测试夹具、套接字和构建中间文件会自动生成。它们可以删除并重新生成，不是长期依赖。`dist/`、桌面产物和 `test-results/` 不提交。

## 日常验证

```sh
npm run check
npm run test:e2e
npm run test:redesign
npm run test:polish
npm run test:editor
npm run test:files
npm run test:diff
npm run test:visual
npm run test:performance
npm run test:main-performance
npm run test:diff-scroll
npm run verify:package
```

`check` 包含类型检查、公共接口测试、Go 的 Node 查找与文件读写测试和网页/服务构建。只运行 Go 测试可使用 `npm run test:go`，不会打开窗口。浏览器测试使用隔离数据与无头 Chrome，不连接日用 Agent。截图和测试结果在 `test-results/`，下次运行会更新。`test:visual` 从 `dist/web` 读取网页资源；修改 `web-src` 后先运行 `npm run build`，否则截图和断言仍来自旧构建。

性能测量口径、历史对照和后续调查入口见 [性能优化记录](performance.md)。`test:performance` 检查 Markdown 块复用并采样渲染及工作区接口，结果在 `test-results/performance/`；同机前后对照时单独运行，不与其他测试并发。当前旧视觉脚本的已知失败也记录在该文档，不将未执行的视觉断言视为通过。

`test:main-performance` 专测主界面文件编辑器和 Diff，检查输入时的全文转换、撤销与等长恢复、长行高亮和布局切换是否重复比较。可用 `--ref=<commit> --baseline` 在当前依赖环境中打包该提交的 `editor.js` / `diff.js` 作对照；`--profile` 保存主编辑器 CPU profile。独立 Markdown 窗口和 pi 集成的低优先级探针保存在 `.scratch/performance/research/`，不属于默认回归。

`test:diff-scroll` 在真实 Git 第三栏中显示 5,000 行 Diff，检查高亮、往返滚动时的内容节点与接口请求，并采样帧间隔。`test:diff-scroll-native` 自动构建测试包，通过系统像素滚轮事件测试真实 WKWebView；会占用焦点、移动鼠标，结束时恢复鼠标位置。两者均单独运行，不与其他测试并发。`--ref=<commit> --baseline` 仅叠加指定提交的 `web-src/style.css` 做样式对照，不是完整历史构建。rAF 间隔不是屏幕实际呈现帧率；实机时延门槛不作为跨硬件保证。

`test:editor` 覆盖文件树预览、相对图片、默认预览、栏宽拖动与恢复、剪贴板 JPEG、保存取消、关闭保存、查找替换和外部修改。原生对话框使用 IPC 替身，不打开系统面板；磁盘写入与冲突另由 Go 测试覆盖。截图在 `test-results/editor/`。`test:desktop` 实测系统保存面板的取消与落盘、再次保存，以及 macOS 文件打开事件进入已运行的独立编辑窗口。Finder 冷启动仍需单独验收。

桌面回归另覆盖主界面约 818KB 文件的末尾导航、输入后未保存状态与完全撤销恢复，并记录 WKWebView 采样；采样不是输入法时延指标。

`test:files` 覆盖新建、保留草稿的重命名、跨项目复制/移动、废纸篓与撤回、同名冲突、快速找文件、展开/折叠记忆和回到应用时的项目行高度。使用隔离目录与无头 Chrome；macOS 废纸篓测试只操作测试创建的文件，不打开 Finder。截图在 `test-results/file-explorer/`。

## 桌面测试

原生测试会打开独立测试窗口、改变焦点并发送真实按键。执行前说明影响并取得用户许可，测试期间避免切换其他应用。首次可能需要给实际运行测试的终端或 Agent 宿主授予 macOS“辅助功能”权限；权限被拒绝时按系统提示处理，不绕过授权。

```sh
npm run test:desktop
# 独立运行的真实长 Diff 滚动回归：
npm run test:diff-scroll-native
```

该命令自动构建带自动化能力的测试包，放在 `dist-desktop-test/Galley Test.app`。测试使用独立数据目录与内存页面会话，结束时关闭自己的进程和服务。它不会覆盖 `dist-desktop/Galley.app`，测试后不必补做发布构建。

真实中文候选专项可指定本机已启用的输入法：

```sh
npm run test:desktop -- --ime=com.bytedance.inputmethod.doubaoime.pinyin
```

上例是已验收的豆包拼音 ID，不代表所有机器都安装了它。普通按键测试临时选择 ABC，专项测试再选择指定中文输入法，避免候选态影响快捷键断言；无论成功或失败，结束时恢复测试前的输入法。`swift test/input-source.swift` 可查看当前 ID。结果与组合输入记录保存在 `test-results/desktop/`。

## 构建和更新日用应用

当前 UI 快速反馈阶段直接修改源码，完成必要快检后默认重建正式桌面包，不再单独等待用户要求重建。应用正在运行时按下文正常退出、停止服务、重建并重新打开；退出被取消时不强制结束进程。

```sh
npm run build:desktop
open "dist-desktop/Galley.app"
```

发布构建自动包含网页和服务构建、Go 编译与本机签名校验，不复制 Node、Node 许可证或 `runtime.json`。先在独立目录完成编译和签名，成功后才替换正式产物；失败时旧应用保持不变。构建接受 Node ≥22.19.0，`.node-version` 仍固定推荐开发版本。运行 `.app` 需要本机已有 Node ≥22.19.0，不需要 Go。

分发 DMG 使用 UDZO 压缩；当前仍为本机 ad-hoc 签名，未做开发者签名或公证，下载后可能被 Gatekeeper 拦截。默认产物对应构建机器的 CPU 架构，不是 Universal 包；分享时需注明 Apple Silicon 或 Intel。

若目标应用或它的后台服务仍在使用产物，构建会提前拒绝覆盖。按以下顺序更新：

1. 正常退出 Galley。让关闭保护处理文件草稿和非空临时文档；取消退出时保留内容，不强制杀进程。
2. 运行 `npm run stop` 停止旧审查台服务。它不终止 pi Agent，也不删除项目和轮次数据。有活跃会话时先说明这次短暂中断。
3. 运行 `npm run build:desktop`，再用上面的 `open` 命令启动。
4. 若本次更新了已安装的 pi 扩展，相关活跃 pi 会话还需要 `/reload`。没有活跃会话时不需要补做。

窗口关闭或退出外壳不会自动停止后台服务，因此只退出窗口还不能覆盖服务使用中的应用。网页修改后仅重启旧包也不会更新内容，必须重新构建。

`/review` 的应用查找顺序见 README。当前默认使用仓库的正式构建产物；测试包不是日用应用。发布产物不包含自动化入口，不能拿测试包交付。

## Node 查找与配置

桌面应用依次检查：

1. `REVIEW_CONSOLE_NODE` 指定的可执行文件。
2. `--node=/absolute/path/to/node` 启动参数；`/review` 自动传入 pi 的 `process.execPath`。
3. PATH 中的 `node`。
4. 常见安装位置：Homebrew、`~/.local/share/pi-node/current/bin/node`、Volta、nvm、fnm。fnm 只检查稳定安装目录，不检查临时 multishell 链接。
5. 最后运行 `zsh -lic 'command -v node'`，读取登录 shell 配置。

前两项是显式配置，无效或低于 22.19.0 时直接报错。自动查找会跳过不合格候选，使用第一个合格版本。每次版本探测最多 1 秒，shell 查找最多 2 秒，总查找预算约 5 秒。失败时原生错误框优先显示恢复方法，完整查找诊断写入 stderr，并可通过“复制信息并退出”保留。关闭错误框后退出，不启动新服务，也不停止已有服务。

Finder 不继承终端的完整 PATH。通常安装 Homebrew Node 后即可自动找到：

```sh
brew install node
```

没有 Homebrew 时可从 https://nodejs.org/zh-cn/download 安装 Node.js ≥22.19.0；已通过 Homebrew 安装但版本过旧时运行 `brew upgrade node`。已安装但无法找到时，先在终端运行 `command -v node` 获取实际路径；设置环境变量只指定已有安装，不会安装 Node。

需要固定其他位置时，终端启动可使用环境变量；Finder 启动可设置当前登录会话的环境后重新打开应用：

```sh
REVIEW_CONSOLE_NODE="/absolute/path/to/node" "dist-desktop/Galley.app/Contents/MacOS/Galley"
launchctl setenv REVIEW_CONSOLE_NODE "/absolute/path/to/node"
```

将示例路径替换为实际 Node 可执行文件路径。`launchctl setenv` 仅作用于当前登录会话；取消固定位置用 `launchctl unsetenv REVIEW_CONSOLE_NODE`。

显式配置失败时，错误框会标明来自 `REVIEW_CONSOLE_NODE` 还是 `--node`。环境变量覆盖启动参数：终端启动可用 `unset REVIEW_CONSOLE_NODE` 取消，Finder 启动可用上面的 `launchctl unsetenv` 取消；若 shell 配置文件中也设置了此变量，应一并删除对应配置。`--node` 配置错误则修正或移除该参数；`/review` 传入的路径来自 pi 正在使用的 Node。

## 已安装应用的旧服务恢复

窗口退出后后台服务仍可能运行。检测到旧构建时，错误信息会生成当前安装对应的停止命令，包含 Node、`cli.mjs` 和数据目录的绝对路径，不依赖 npm、源码目录或当前工作目录。

先保存草稿并正常退出审查台，再在终端执行错误信息中的停止命令，随后重新打开应用。活跃 pi 会话需要 `/reload`。停止服务会短暂中断审查台连接，不终止 Agent，也不删除项目和轮次数据；显示错误本身不会自动停止服务。

## 排查与边界

- “Node 未安装、版本过旧或指定路径无效”：按错误框安装 Node ≥22.19.0 或修正 `REVIEW_CONSOLE_NODE`；Finder 配置见上节。显式配置错误不会被自动查找掩盖。
- “服务来自旧构建”：源码开发按正常退出、停止服务、重新构建和启动流程处理；只安装 `.app` 时按错误信息中的停止命令恢复，避免新旧网页与后端混用。
- 原生按键测试失败：先确认目标窗口和异步操作已准备好，检查是否有输入法候选；保留错误与测试结果，不直接认定产品回归。
- 新报错：先保存错误原文、操作步骤、构建版本，再复现。过去那次没有原文的报错未复现，没有证据支持预先改代码。
- Git 提交详情必须继续返回全部 diff；读取通过 raw diff 和 `cat-file` 批处理，避免每个文件版本启动多个串行 Git。`test/history-batch.test.ts` 保护查询次数和比较语义。
- Markdown 编辑窗口通过桌面桥打开与保存文件；未保存文档及粘贴图片暂存在内存，不自动恢复。临时 Diff 仍不写盘。关闭时处理保存选择，不跳过提示。软换行按逻辑行显示行号。
- 旧 compact-tool / visual-reply 的日用迁移尚未执行，不是本轮遗留代码修复。只有明确授权迁移时才按 README 的迁移步骤操作；常规构建和测试不改旧插件、个人 pi 配置或调用模型。
- 规格和任务的变更保存在仓库对应票据中；当前流程有变时更新本文件，提交前检查差异和测试结果，不留只有用户知道的操作。
