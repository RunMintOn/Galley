Status: ready-for-agent
Resolution: resolved

# 02: 工作区单文件详情避免无关读取

- [x] 先用公共 HTTP 接口证明单文件详情会读取其他未跟踪文件。
- [x] 单文件请求只读取目标需要的文本，工作区概览计数和完整 Diff 不变。
- [x] 验证 staged、unstaged、untracked、二进制及特殊路径。
- [x] 记录包含大量未跟踪文件的请求前后耗时，并运行相关回归。

## Comments

2026-11-01：公共接口回归先失败（staged 请求读取 40 个无关文件），修改后通过。120 个无关文件、各 10,000 行的夹具，请求中位数 822.1→124.1ms。完整 Diff、既有工作区概览、根提交与重命名语义通过原有测试。测量和验证入口见 `docs/performance.md`。
