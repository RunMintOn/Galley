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
npm run test:diff
npm run test:visual
npm run verify:package
```

`check` 包含类型检查、公共接口测试和网页/服务构建。浏览器测试使用隔离数据与无头 Chrome，不连接日用 Agent。截图和测试结果在 `test-results/`，下次运行会更新。

## 桌面测试

原生测试会打开独立测试窗口、改变焦点并发送真实按键。执行前说明影响并取得用户许可，测试期间避免切换其他应用。首次可能需要给实际运行测试的终端或 Agent 宿主授予 macOS“辅助功能”权限；权限被拒绝时按系统提示处理，不绕过授权。

```sh
npm run test:desktop
```

该命令自动构建带自动化能力的测试包，放在 `dist-desktop-test/Review Console Test.app`。测试使用独立数据目录与内存页面会话，结束时关闭自己的进程和服务。它不会覆盖 `dist-desktop/Review Console.app`，测试后不必补做发布构建。

真实中文候选专项可指定本机已启用的输入法：

```sh
npm run test:desktop -- --ime=com.bytedance.inputmethod.doubaoime.pinyin
```

上例是已验收的豆包拼音 ID，不代表所有机器都安装了它。普通按键测试临时选择 ABC，专项测试再选择指定中文输入法，避免候选态影响快捷键断言；无论成功或失败，结束时恢复测试前的输入法。`swift test/input-source.swift` 可查看当前 ID。结果与组合输入记录保存在 `test-results/desktop/`。

## 构建和更新日用应用

```sh
npm run build:desktop
open "dist-desktop/Review Console.app"
```

发布构建自动包含网页和服务构建、打包 Node、Go 编译与本机签名校验。先在独立目录完成编译和签名，成功后才替换正式产物；失败时旧应用保持不变。运行 `.app` 不依赖系统 Node 或 Go。

若目标应用或它的后台服务仍在使用产物，构建会提前拒绝覆盖。按以下顺序更新：

1. 正常退出 Review Console。让关闭保护处理文件草稿和非空临时文档；取消退出时保留内容，不强制杀进程。
2. 运行 `npm run stop` 停止旧审查台服务。它不终止 pi Agent，也不删除项目和轮次数据。有活跃会话时先说明这次短暂中断。
3. 运行 `npm run build:desktop`，再用上面的 `open` 命令启动。
4. 若本次更新了已安装的 pi 扩展，相关活跃 pi 会话还需要 `/reload`。没有活跃会话时不需要补做。

窗口关闭或退出外壳不会自动停止后台服务，因此只退出窗口还不能覆盖服务使用中的应用。网页修改后仅重启旧包也不会更新内容，必须重新构建。

`/review` 的应用查找顺序见 README。当前默认使用仓库的正式构建产物；测试包不是日用应用。发布产物不包含自动化入口，不能拿测试包交付。

## 排查与边界

- “服务来自旧构建”：按上面的正常退出、停止服务、重新构建和启动流程处理，避免新旧网页与后端混用。
- 原生按键测试失败：先确认目标窗口和异步操作已准备好，检查是否有输入法候选；保留错误与测试结果，不直接认定产品回归。
- 新报错：先保存错误原文、操作步骤、构建版本，再复现。过去那次没有原文的报错未复现，没有证据支持预先改代码。
- Git 提交详情必须继续返回全部 diff；读取通过 raw diff 和 `cat-file` 批处理，避免每个文件版本启动多个串行 Git。`test/history-batch.test.ts` 保护查询次数和比较语义。
- 临时文档内容只在内存中，不写盘、不自动恢复；软换行按逻辑行显示行号。关闭确认是内容保护，不是构建时可以跳过的提示。
- 旧 compact-tool / visual-reply 的日用迁移尚未执行，不是本轮遗留代码修复。只有明确授权迁移时才按 README 的迁移步骤操作；常规构建和测试不改旧插件、个人 pi 配置或调用模型。
- 规格和任务的变更保存在仓库对应票据中；当前流程有变时更新本文件，提交前检查差异和测试结果，不留只有用户知道的操作。
