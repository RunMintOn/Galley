# 01: UI 打磨批次（预览一致性、字体、折叠控件、缩放、原生选目录、空状态）

**What to build:** 临时文档窗口的预览与审查台回复栏表现一致（公式、Mermaid、函数图都能渲染）；正文换成可切换的系统字体；所有栏的折叠/展开控件换成同一套面板图标、命中区放大、入口不再重复，收起后不再连带收起另一栏；桌面上支持 `Cmd +/−/0` 缩放；添加目录时弹出 macOS 原生选择面板；本轮没有改动时不再显示无意义的 Tree/Flat 切换。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent
**Resolution:** resolved

- [x] 临时窗口预览渲染 KaTeX、Mermaid、函数图，与回复栏同一套渲染结果
- [x] 正文默认系统字体，可在回复栏和临时窗口切换（系统 / 衬线 / 等宽），选择跨窗口保持
- [x] 四栏折叠控件统一为面板图标，命中区不小于 32×32，收起后整条窄栏可点开
- [x] 重复入口消失：窄条上不再有 `☰`，项目菜单不再有"收起项目栏"
- [x] 收起内容栏不再连带收起文件栏，展开文件栏不再连带展开内容栏
- [x] 桌面应用中 `Cmd +`、`Cmd -`、`Cmd 0` 调整/复位窗口缩放
- [x] `＋ Add folder` 在桌面应用中打开原生目录选择面板，浏览器模式仍可手输
- [x] 本轮改动为 0 时隐藏 Tree/Flat 切换，未选项目时不显示空的 FILES 标题

## Comments

Resolved：临时窗口与回复栏共用同一渲染器（公式、Mermaid、函数图）；正文默认系统字体，回复栏与临时窗口同一 `review-font` 选择；四栏折叠控件统一为内联 SVG 面板图标、32×32 命中区、收起后整条窄栏可点，删除 `☰` 与菜单重复项，取消除折叠联动；桌面上 `Cmd +`/`Cmd -`/`Cmd 0` 通过 mygo `SetZoomFactor` 缩放当前窗口，并写入 View 菜单；`Add folder` 在桌面调用 `Desktop.PickFolder` 打开系统目录面板，浏览器与桥接失败时回退为手输；本轮改动为 0 时隐藏 Tree/Flat。回归覆盖见 `test/redesign.mts`、`test/visual.mts`、`test/desktop.mts`。
