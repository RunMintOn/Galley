# 暂停的摸排

2026-11-01 用户调整优先级：主界面编辑器优先；pi 集成与独立 Markdown 窗口不优先。这里的脚本只是历史调查入口，不加入默认测试，也没有对应产品优化。

- `document-poll.mts`：从仓库根目录运行。需先 `npm run build:desktop -- --e2e`；会打开独立原生测试窗口，需桌面操作授权。记录当前 `ReadDocument` 路径的传输量和耗时。
- `session-state.mts`：先 `npm run build`，再从仓库根目录运行。隔离 Chrome 与本地假会话桥；轮次节点/元数据请求断言在当前未优化实现上预期失败，但保存采样结果。

产物位于 `test-results/performance/`。对应票据为 `issues/03-document-poll.md` 和 `issues/04-session-state.md`。
