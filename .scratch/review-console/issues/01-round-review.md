# 01: 真实轮次的改动与回复同屏

**What to build:** 一个隔离 pi 会话完成工作后，用户可打开审查台看到配对的快照报告和渲染回复。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

+- [ ] 真实 pi 加载器验证 Edit/Write/apply_patch 捕获和最终稳定结束的关联；保留现有捕获边界。
- [ ] 共享本地服务有 Host、Origin、认证守卫，报告持久化、回复按引用读取。
- [ ] 浏览器同屏展示本轮与回复，unified/split、词级差异和图表使用迁入实现。
- [ ] 已有 compact 捕获仍启用时拒绝启动新捕获，旧插件与用户配置不变。
