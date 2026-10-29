Status: ready-for-agent
Resolution: resolved
Blocked by: 03

# 05：本轮索引、上下文与四栏 Split

## Goal

完善 Review 的索引—内容工作流，复用已有 diff 配对而不是重新发明算法。

## Scope

以 [spec.md](../spec.md) 为产品与数据契约来源。本票实现已完成；验收证据和未专项验证的边界见 Comments。

## Acceptance

- [x] 先补行为测试；本轮列表支持 Flat / Tree，完整仓库树在下方独立保留；文件数、总增删和轮次时间范围准确。
- [x] 用户消息在 diff 上方按报告顺序显示，默认展开可收起；长消息不挤掉整个 diff，无消息有明确状态。
- [x] 使用 report.start/end 表示轮次时间，不把它伪装成每条 prompt 的发送时间；保留捕获范围与不完整提示。
- [x] diff 头部含文件、统计、n/N、Unified / Split、wrap；四栏内容宽度下 Split 可用，每次切入自动 wrap，手动关 wrap 后可横向滚动。
- [x] 替换行按删除/新增顺序配对，缺侧留空，折行后同一对仍对齐；上下文旧新行号各自正确，不因前面增删错位。
- [x] hunk 间缺失上下文按实际行号显示准确的“还有 N 行未改动”，不把已折叠 DOM 行与未加载间隙混算。
- [x] 切换项目/会话/轮次时第二、三栏与回复对应；快速切换不显示旧请求结果，不跳过草稿保护。
- [x] 保留打开完整文件、j/k 导航和既有草稿保护；测试覆盖长行、不等长替换、多个 hunk、空变化及中断报告。

## Implementation Notes

主要位置：`web-src/app.js`、`web-src/diff.js`、`web-src/diff.css`、`src/diff.ts`、`test/browser.mts`。已有 Split 只是窄于 720px 禁用；临时 Diff 后续复用配对职责，不复制原型的独立算法。

## Comments

Resolved：

本轮 Flat/Tree 与完整仓库树独立；用户请求默认展开、可收起并显示轮次时间。四栏 Split 可用，进入自动 wrap，旧新行号独立，配对和 hunk 间提示复用已有 diff。既有编辑与轮次浏览 E2E 通过。

共同证据：[桌面验收记录](../../../docs/redesign-verification.md)。检查项表示交付工作已处理；运行验证的具体范围以记录为准，不据此声称所有输入法、剪贴板格式或大型仓库已逐一实测。
