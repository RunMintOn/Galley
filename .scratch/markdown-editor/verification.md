# 实现与验证

## 已执行
- `npm run typecheck`：通过。
- `npm test`：12 项公共接口/服务测试与 Go 测试通过。
- `npm run test:editor`：4 项新编辑流程通过。涵盖文件预览、实际 JPEG 粘贴显示、保存取消、关闭保存、查找替换、外部修改和栏宽记忆。
- `npm run test:polish`：6 项通过，保留软换行、光标、撤销与标签切换。
- `npm run test:e2e`：原有审查、回复、保存、冲突与会话流程通过。
- `npm run test:visual`：通过，文件树目录标签从 `src/` 改为 `src`，对应定位已更新。
- `npm run build:desktop -- --e2e`：独立测试包编译与签名通过，未启动窗口。
- 用户授权后执行 `npm run test:desktop`，并扩充后直接运行 `node --experimental-strip-types test/desktop.mts`：均通过。新增原生保存取消、指定临时目录落盘、再次保存、通过 `open -a <测试应用> <测试文件>` 进入已有编辑窗口。全部使用临时目录。

## 视觉审视
截图在 `test-results/editor/` 与 `test-results/ui/`。已检查深浅主题、源码/分栏、文件树、默认预览、窄窗口。去掉主内容区嵌套卡片、统一中性灰分隔线；代码与文件类型颜色有用途，不用于装饰边框。

## 未执行
- 原生“打开”文件选择面板与 Finder 冷启动；已有实例通过 macOS 文件打开事件已验收。
- 日用应用替换。

网页测试使用真实编辑器与服务及 IPC 替身；原生保存面板和已有实例文件打开另有桌面实测证据。日用应用与后台服务保持原 PID 运行，未关闭、替换或停止，不访问用户未保存文档。
