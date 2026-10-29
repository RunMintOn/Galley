# 第二轮：macOS 桌面化与视觉刷新验收

本文是分轮历史验收记录。当前环境、构建、测试与安全更新流程以 [开发与交接](development.md) 为准，不依赖早期临时工具链或交接文件。

实现分支：`integration/review-console-redesign`。审查基线：`e3c7a20`（实施前文档记录）。范围为 `.scratch/review-console-redesign/spec.md` 及其 10 个 Ticket；未接管旧插件、未接入日用会话、未发起模型调用。

## 交付

- `dist-desktop/Review Console.app`：macOS arm64 本机可运行应用，mygo / WKWebView，随包 Node 22.23.2。
- mygo 固定 `v0.7.4-0.20261029110259-0cb6d05d55b7`；初始验收使用隔离 Go 1.27.3，现已改用正常全局安装，见开发文档。
- 两窗口共用后台服务；原生菜单、标签快捷键、关闭/退出保护、单实例会话交接已接入。`/review` 优先启动桌面应用，未发现应用时保留浏览器入口。
- 最终产物为非 e2e 构建；即便设置 `MYGO_AUTOMATION` 也不暴露自动化套接字。`codesign --verify --deep --strict` 通过；本机 ad-hoc 签名，不是公网签名公证发行包。

## 实际验证

| 检查 | 结果与证据 |
|---|---|
| `npm run check` | 类型检查、8 项现有/新增公共接口测试、网页/服务构建通过 |
| `npm run test:e2e` | 编辑与草稿保护、多会话、轮次、历史全文/blame、公式/Mermaid/函数图、IME 发送保护、断线恢复通过 |
| `npm run test:redesign` | 项目最新轮次徽章、本轮请求、四栏 Split、工作区比较基准及重新聚焦后当前 diff 刷新、独立临时标签页通过 |
| `npm run test:visual` | 既有视觉流程更新后通过；截图供人工评审，不用像素或旧插件字体/颜色断言冒充验收 |
| `npm run verify:package` | npm 包无 node_modules 可启动，后台服务复用及停止通过 |
| `npm run build:desktop -- --e2e` + `npm run test:desktop` | 真 WKWebView 双窗口、原生菜单、真实 Cmd+T/W/1 和文本按键、真实关闭确认 Cancel、非空关闭取消、单实例定位、退出外壳后服务存活通过 |
| 最终 release 冒烟 | 通过 LaunchServices（与 Finder 同一路径）启动，PATH 仅 `/usr/bin:/bin`，无需系统 Node；退出后服务仍在；无自动化端口 |
| `git diff --check` | 通过 |

桌面测试使用明确的临时服务目录、测试应用名和内存 WebView Session；用户已明确许可测试窗口、焦点和原生按键操作。网页测试使用无头 Chrome；并未用 Chrome 结果替代 WKWebView。`/review` 的扩展测试验证启动参数，真实桌面测试验证会话参数交接，不声称运行过用户的真实 pi TUI/模型会话。

原型 HTML 已实际点击检查 Git 模式、临时窗口横纵标签与纸色，参考截图保留。原型没有被改动。

### 行为覆盖归属

- 故事 1—4：`test/redesign.mts`、`test/workspace.test.ts`，项目会话记忆与最新轮次徽章在 `web-src/app.js`。
- 故事 5—9、29—30、40：共享视觉/主题与 `test/visual.mts`、`test/redesign.mts`；深浅 × Charcoal/Ivory 截图。
- 故事 10—18：`test/browser.mts`、`test/redesign.mts`，本轮上下文与共享 diff。
- 故事 19—27：`test/git.test.ts`、`test/workspace.test.ts`、两套网页行为流程；覆盖根/合并提交、特殊路径、二进制、无 HEAD、重命名及分组比较。
- 故事 28、31—32：既有编辑/会话/回复 E2E，回复链接现在明确打开当前文件。
- 故事 33—38：`test/redesign.mts`、`test/desktop.mts`，Markdown 与 Diff、多标签、布局切换、关闭保护与内容保留。
- 故事 39 与桌面新增范围：`test/desktop-entry.test.ts`、`test/desktop.mts` 及 release 冒烟。

## 资源实测

- 最终 `.app` 磁盘占用：134,164 KiB，约 **131.0 MiB**；其中随包 Node 可执行文件约 108 MiB。不能把 mygo 可执行文件的几 MB 当作整个应用体积。
- 最后一次双窗口小夹具测试，外壳进程 RSS 为 126,160 KiB，约 **123.2 MiB**。这是外壳进程，不包含独立 Node 服务和 WebKit 内容/辅助进程，不能冒充应用总物理内存。
- npm 独立服务夹具记录 RSS 为 57,376,768 字节。与上项并非同次全进程采样，不作简单相加，也不据此承诺生产内存上限。
- 未做长期压力测试、反复切换性能采样或大型日用项目基准；本轮没有这类已确认预算。

## 双轴自审

在同一上下文完成，无子 Agent/额外 worktree。固定比较为 `git diff e3c7a20...HEAD`，另检查收尾修改。

### Standards

未发现需扩展范围的结构问题。复用现有 Node 服务、Markdown 渲染与 diff 配对，没有新增前端框架、npm 依赖、通用插件抽象或 Go 业务后端。测试仍使用既定公共接口与真浏览器/原生窗口边界。历史 VisualReply 参考改为显式 opt-in，常规验证不访问日用旧服务。

### Spec

发现并修复 2 项问题：当前工作区 diff 未随列表刷新；空文件被误标为删除。分别新增浏览器和 Git 公共接口回归测试，先失败再修复，相同测试通过。同步修正列表请求失效处理、折叠展开语义、主题浅色 diff 令牌，以及未加载页面的安全退出。保留了合并父版本、引用筛选、历史全文、blame、文件编辑和草稿保护。

无已知阻断交付的遗留代码问题；以下是验证边界，不伪装成已执行。

## 验证边界与限制

- 中文文本编辑与浏览器 composition/发送保护已检查；没有专项切换用户系统输入法，也没有专项操作跨应用剪贴板。系统编辑菜单沿用 WKWebView/mygo 的原生能力，不把代码核对冒充运行实测。
- 未做多日真实会话运行、Windows/Linux、对外签名公证、自动更新、旧插件迁移或配置切换。
- 主窗口最小 950×600，临时窗口最小 700×500；1160px 以下导航变窄，仍可手动折叠。1440px 为完整四栏基准。
- 原生退出采用异步预检，AppleScript `quit` 可能先返回取消码 -128，随后应用完成退出。release 冒烟核对了最终进程退出和后台服务存活，不以该命令退出码代替产品结果。
- 当前机器构建的是 arm64 包；没有宣称已验收 Intel Mac。

## 可复现入口与结果

```sh
npm run check
npm run test:e2e
npm run test:redesign
npm run test:visual
npm run verify:package
npm run build:desktop -- --e2e
npm run test:desktop
npm run build:desktop  # 最终交付使用非自动化构建
```

上面的逐步命令记录当时的验收过程；当前 `test:desktop` 自动构建独立测试包，完整流程见开发文档。测试/截图会更新 `test-results/`，不提交生成产物。

- 新界面与四种主题/纸色：`test-results/redesign/`。
- 真实桌面截图及结果：`test-results/desktop/result.json`、`review.png`、`scratch.png`。
- 发布冒烟：`test-results/desktop/release.json`。
- 既有视觉流程：`test-results/ui/`。
- 最初接入探针和操作偏差记录：`.scratch/review-console-redesign/mygo-feasibility.md`。

## 第四轮：源码编辑器与第三轮 review 收尾

范围：`.scratch/review-console-polish/issues/02-editor-and-review-fixes.md`，同一对话实施和自审，无 subagent。

- 修复浏览器 Add folder 未弹手输框、950px 初始布局多分配 20px、折叠后图标方向不更新。
- 临时 Markdown 与 Diff 两侧输入改用现有 CodeMirror 依赖。软换行沿用 VS Code 的逻辑行语义，不新增折行行号；提供当前行高亮、选区、等宽源码与撤销。各标签独立保留 EditorState、选择、历史与滚动快照，不写盘。
- 桌面 Undo/Redo 菜单转发到聚焦的 CodeMirror 历史，普通输入框回退 WebKit 原生撤销；其余编辑菜单保留原生行为。真实按键和菜单分别检查，不以浏览器快捷键代替。

本轮执行通过：`npm run check`、`test:polish`（6 项）、`test:e2e`、`test:redesign`、`test:visual`、`test:diff`、真实 `test:desktop`。当时桌面测试在隔离源码副本构建运行，未在测试期间替换日用应用 backend；该副本不是后续开发前提。

真实中文输入专项命令：

```sh
npm run test:desktop -- --ime=com.bytedance.inputmethod.doubaoime.pinyin
```

`--ime` 必须指定本机已启用的输入法 ID。该检查会在测试窗口临时切换输入法，结束后恢复原选择。本次实际使用豆包拼音：记录到 `compositionstart/update/end`，空格与数字确认 `你好`，Enter 按输入法自身规则提交 `zhongwen`，无额外换行、标签误切或焦点丢失；预览与上屏内容一致，撤销及重做通过。CodeMirror 可以合并连续组合输入为一条撤销记录，不自行改写其分组规则。没有宣称验收其他输入法或真实跨应用剪贴板。

桌面测试脚本修正了两类自动化偏差：等待异步菜单命令完成、明确聚焦目标窗口后才发按键；系统“前往文件夹”输入用 AX 一次填入路径，避免快速按键被路径补全吞掉。原先焦点抖动不被直接认定为产品缺陷。

证据更新在 `test-results/desktop/`：`result.json`、`ime.json`、`review.png`、`scratch.png`、`release-round4.json`。最终非 e2e 包通过签名校验；最小 PATH 下启动、无自动化套接字、退出后后台服务存活通过。随后正常关闭日用外壳，停止无活跃会话的旧服务，安装并启动新包；构建身份 `e5a080e7da20912d`，原有 2 个项目保留，输入法恢复 ABC。

历史不明“报错”未复现，不据猜测修改代码；若再出现，先取得原始文案或截图。本轮没有剩余已确认的实现待办。

## 历史提交读取性能修复

票据：`.scratch/review-console-polish/issues/03-batch-commit-history.md`。只优化读取方式，未引入按需加载，未改变文件展开方式。

- 原实现每个文件版本分别执行 `ls-tree`、`cat-file -s`、`cat-file blob`，31 文件提交串行启动 152 次 Git，约 2.5 秒；Node 其余处理约 16ms。
- 改为 raw diff 批量获取两侧对象 ID、`cat-file --batch-check` 批量检查类型和大小、`cat-file --batch` 批量读取内容，继续计算并返回全部文件的 diff。每文件 2 MiB 上限、二进制/非 UTF-8 不可用提示、500 文件截断规则保留。
- 同一个 31 文件提交后端实测 129–131ms、6 次 Git；5 个真实提交的新旧响应逐字段一致。无头 Chrome 请求由 2340ms 降至 121ms，仍返回全部 31 个 diff 和原有 317439 字节数据。
- 新增公共 HTTP 接口回归，40 个不同内容文件要求全部 diff 正确且 Git 启动次数不超过 8；原实现实际 245 次，测试先失败后通过。另验证根提交、重命名及制表符/换行/中文路径、空文件、删除、二进制、无效 UTF-8、超限文件、跨项目子目录移动；既有合并父版本测试通过。
- 执行通过：`npm run check`（9 项单测）、`test:e2e`、`test:redesign`、`test:polish`、`test:diff`。本次未重跑原生输入法专项，未改动前端或原生交互代码。
- 最终非 e2e 桌面包通过签名校验，已正常替换并启动；安装后构建身份 `4dbeeb267f68338c`，实际接口 165ms 返回全部 31 个 diff。证据：`test-results/history/performance.json`、`installed.json`、`commit.png`。
