# 性能调查探针

## 高刷新率

[120Hz 调查](high-refresh.md)保存路线取舍、合成输出测量与工具踩坑；`refresh-probe/run.mts` 用于复现实验，不加入默认测试。日用高刷已交付，常规产品回归沿用[开发流程](../../../docs/development.md)，无需先重跑选型实验。两类真实窗口测试都需桌面操作许可。

## 暂停事项

2026-11-01 用户调整优先级：主界面编辑器优先；pi 集成与独立 Markdown 窗口不优先。这里的脚本只是历史调查入口，不加入默认测试，也没有对应产品优化。

- `document-poll.mts`：从仓库根目录运行。需先 `npm run build:desktop -- --e2e`；会打开独立原生测试窗口，需桌面操作授权。记录当前 `ReadDocument` 路径的传输量和耗时。
- `session-state.mts`：先 `npm run build`，再从仓库根目录运行。隔离 Chrome 与本地假会话桥；轮次节点/元数据请求断言在当前未优化实现上预期失败，但保存采样结果。

产物位于 `test-results/performance/`。对应票据为 `issues/03-document-poll.md` 和 `issues/04-session-state.md`。
