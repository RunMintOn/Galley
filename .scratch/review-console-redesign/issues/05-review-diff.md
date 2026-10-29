Status: ready-for-agent
Blocked by: 03

# 05：本轮索引、上下文与四栏 Split

## Goal

完善 Review 的索引—内容工作流，复用已有 diff 配对而不是重新发明算法。

## Scope

以 [spec.md](../spec.md) 为产品与数据契约的唯一来源，尤其“执行边界与交付顺序”。本票未开始；当前仅授权文档准备，实施需用户另行授权。

## Acceptance

- [ ] 先补行为测试；本轮列表支持 Flat / Tree，完整仓库树在下方独立保留；文件数、总增删和轮次时间范围准确。
- [ ] 用户消息在 diff 上方按报告顺序显示，默认展开可收起；长消息不挤掉整个 diff，无消息有明确状态。
- [ ] 使用 report.start/end 表示轮次时间，不把它伪装成每条 prompt 的发送时间；保留捕获范围与不完整提示。
- [ ] diff 头部含文件、统计、n/N、Unified / Split、wrap；四栏内容宽度下 Split 可用，每次切入自动 wrap，手动关 wrap 后可横向滚动。
- [ ] 替换行按删除/新增顺序配对，缺侧留空，折行后同一对仍对齐；上下文旧新行号各自正确，不因前面增删错位。
- [ ] hunk 间缺失上下文按实际行号显示准确的“还有 N 行未改动”，不把已折叠 DOM 行与未加载间隙混算。
- [ ] 切换项目/会话/轮次时第二、三栏与回复对应；快速切换不显示旧请求结果，不跳过草稿保护。
- [ ] 保留打开完整文件、j/k 导航和既有草稿保护；测试覆盖长行、不等长替换、多个 hunk、空变化及中断报告。

## Implementation Notes

主要位置：`web-src/app.js`、`web-src/diff.js`、`web-src/diff.css`、`src/diff.ts`、`test/browser.mts`。已有 Split 只是窄于 720px 禁用；临时 Diff 后续复用配对职责，不复制原型的独立算法。

## Comments

尚未实施、未运行本票测试。
