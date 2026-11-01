Status: ready-for-agent
Resolution: resolved
Type: research

# 07: 120Hz 下的主界面顺滑度与渲染路线对照

用户明确：持续交互需要跟上 120Hz 显示器。不能用“已修复严重卡顿”或约 17ms 的 rAF 回调间隔代替验收。整体原生化是候选，不是已选方案。

## 本轮范围

- 诊断，不迁移产品架构，不替换或重启日用应用。
- 复用 2,500 行全部修改、5,000 行显示结果的 Git Diff 夹具。
- 对照当前 WKWebView、最小 WKWebView 页面、MyGo 原生 Diff。
- 分开报告页面回调、渲染工作与合成输出；没有呈现证据时不声称实际 120fps。

## 完成条件

- [x] 在真实 120Hz 显示器记录测试窗口位置，并复现页面更新的 60Hz / 120Hz 差距。
- [x] 区分应用负载与 WKWebView 调度；最小页面和实际 Diff 使用同口径。
- [x] 检查 MyGo 原生 Diff 的潜在收益；不能只用无窗口 CPU benchmark 判定。
- [x] 给出保留现实现、局部原生化或继续调查的建议及证据边界。

## Comments

调查已完成；实验设计、测量边界、结论和未决问题统一见 [120Hz 调查](../research/high-refresh.md)。保留 WebView，没有选择原生重写。

用户随后授权实际启用，接入、产品回归与日用更新已由 [08](08-enable-high-refresh.md) 完成，无待确认授权。本票据关闭不代表用户整体体感已验收。
