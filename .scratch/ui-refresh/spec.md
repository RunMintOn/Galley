# UI refresh: control and detail pass

**Status:** 已实现（2026-10-30）；headless 测试通过；`dist-desktop` 已重建，待用户打开 app 做最终视觉验收。
**Visual contract:** `mockup/index.html`（底部 bar 可对比，`Review notes` 有 13 条变更和对应高亮）。
**Implementation brief:** `handoff.md`。
**决策与边界:** `mockup/README.md`。

## 目标

把审查台和 Markdown 编辑窗口统一成一套控件语言。**不是重做**：保留现有配色、字号体系、四栏骨架、diff 的增删语义、阅读栏排版和快捷键。用户认可的只是当前底子，问题是控件位置、形状、状态和若干细节。

## 后续细节轮：源码已实现，待用户反馈

以下新决策取代下文旧版项目两行及窄栏隐藏规则。用户已要求本阶段直接改源码快速反馈，不再先改原型或等待原型确认。

- 项目按名称、分支、路径三行显示，无分支时两行；长分支省略，不挤项目名。右键提供 Remove，仅移出列表。
- 零改动时移除多余横线和空隙。Git 无改动只留淡色 `No uncommitted changes`，不显示空分组和零统计。
- 普通目录保留 Git 入口，以淡色说明非 Git 仓库；不弹通知，不限制说明只能出现一处，隐藏无效下拉框。
- Git 提交列表保持三行：标题；作者与短 hash；原时间加相对时间（ago）。不删除原时间，完整日期放悬停提示，增删数放第三行右侧。HEAD 使用自绘下拉菜单。
- 通知可关闭。内容和回复同时折叠时，文件列表占满余宽，展开窄栏贴右；展开后恢复原宽。
- 快速反馈优先，不加防御性逻辑，不跑整套验证。已完成 `npm run build` 和隔离浏览器针对性交互快检；正式桌面包已重建并重新打开。

## 已确认的决策

- **全英文 UI**：菜单、标题、tooltip、aria-label、空状态、notice、confirm、原生错误框。内容（Agent 回复、commit subject、路径、日期）保持原语言。README/docs 可继续中文。
- **文件图标**：一个 16px 文档轮廓，按类型着色（markdown / code / config / image），默认开启。删除 `↓`、`go`、`{}`、`JS` 这类文字符号和 20px Markdown 箭头。
- **diff 语法色**：本轮做。保留绿/红增删底色和文字色，额外给 token 上色。Go 需要新增 `@codemirror/lang-go`（6.0.1 已确认存在）；未知语言降级为单色。
- **项目行两行**：第一行名字 + 分支 + 角标，第二行位置。位置从左侧省略（`…/`），完整路径放 `title`，不要尾部截断。
- **第一行贴住栏头**：projects 和 changed list 顶部不得有 padding/margin；选中行底色和 2px marker 贴住 header 的 1px 下边框。这是用户最后一轮专门指出的 4px 缝。
- **三条分界都能拖**：projects/files、files/content、content/reply；双击复位，键盘方向键，持久化，content 最小 280。
- **时间只留一处**：文件栏不再显示 round time；只保留 Round request summary 里的时间。
- **Tree/Flat** 放在 `CHANGED` 栏头、计数右边。
- **files 栏折叠**在底栏最右（方案 B），栏头只留列表数据。

## 为什么第二行是位置，不是分支

当前 fixture 和 app 截图里多数项目不是 Git 仓库（观察，不是全量审计）。第二行放分支会让大部分行空着；位置每个项目都有，也能区分同名项目。分支保留在第一行；没有分支数据就省略，不要伪造。

## Preserve：mockup 是视觉参考，不是功能清单

mockup 是静态的，以下既有功能没画出来，但必须保留，只换样式：

- 轮次时间和 Tree/Flat 切换（0 改动时隐藏 Tree）。
- 文件状态 / UTF-8、发送状态、Back to latest。
- 项目菜单和添加目录（只留一个入口）。
- Git refs、workspace 分组、commit list、blame、分页。
- 跨窗口 preview 偏好同步。
- reply paper / ivory / serif 选项、source 临时预览编辑。
- 所有快捷键、滚动和关闭保护。

不确定放置时，保留功能再问用户；不要因为 mockup 没画就删。完整清单见 `handoff.md` 的 Preserve。

## 容易漏的视觉规则

- **两行项目行**：默认 width 210、行高 48；容器窄于 205px 隐藏位置并回到单行 38px；窄于 170px 也隐藏分支。
- **当前项**：一套 2px 中性 marker + 底色；绿色只表示新增或运行中，不再表示“当前”。commit 行原来的绿色左边条改成中性 accent。
- **控件形状**：0 列表行、4 控件、8 弹层/卡片；一个 focus ring、一个 hover、一个 pressed、一个自绘 checkbox；不要 `transition: all`。
- **文档工具栏**：diff 的 Unified/Split、Open file、Wrap 同处；Markdown 的 Source/Split/Preview 与 Edit/Save/Reload 同处；content header 恒定只有 tabs、路径、计数、折叠。footer 只留位置和 j/k。
- **阅读**：正文 16.5/1.68、20px 左右 padding、H1 27（窄窗 25）；标题在深浅主题都用 ink；黄色下划线是唯一阅读强调色；段落加 `text-wrap: pretty` 处理孤字。
- **浅色**：实线 hairline（`#dedede`）替代 8% alpha；`--subtle` 深色 `#8b8b94`、浅色 `#686868`，保证 9.5px 路径可读。

## 本轮的做法（后续 UI 工作沿用）

先给静态 HTML mockup（完成度不用高），用户确认后才改源码；范围是控件/细节 pass，不是重做。用户会看 4px 级的间距和对齐，也会指出每一栏第一条与栏头之间的缝。不要先动源码再让用户看结果。

## 验证坑

`npm run test:visual` 从 `dist/web` 读取网页资源。修改 `web-src` 后先运行 `npm run build`，否则截图和断言仍来自旧构建。本次已实际踩到（旧页脚）。已补进 `docs/development.md`。

## 未决 / 适用条件

- Markdown 编辑窗口没有 mockup：只统一控件、设置、英文文案，不要先改 toolbar/tabs/doc-bar 的行结构；改结构前给用户看截图。
- 分支数据可能不是每个项目都有；没有就省略。路径行是通用的第二行。
- 真实 session 名称和 mockup fixture 不同；规则是可读宽度，不是固定字符串。
- mockup 的 `Project path` / `Type color` / `Syntax colors` 是评审开关，不是产品设置。类型色和语法色在产品里默认开启，不新增用户开关，除非用户要求。
- 当前 `.scratch/ui-refresh/` 是 untracked；用户说不用管干净 clone，开发 Agent 直接在当前工作区使用即可。
