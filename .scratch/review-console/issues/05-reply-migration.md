# 05: 完整回复交互、迁移与最终验收

**What to build:** 用户获得现有回复阅读和纯文本发送能力，新插件独立可安装，旧插件可安全退役。

**Blocked by:** 04：独立 Git 历史与历史文件

**Status:** resolved

- [x] 回复翻页、源码临时编辑、粘贴预览、图表缩放、主题及阅读位置完整。
- [x] 活会话发送验证忙碌、离线、输入法、不确定提交保留草稿。
- [x] 提供可检查的 compact 瘦身迁移产物与回退说明，不修改日用安装或设置。
- [x] 打包、类型检查、完整测试、无头浏览器、3/15 项目资源趋势和双轴自审完成；记录真实结果与未验证项。

## Comments

全部命令通过：`npm run check`、`npm run test:e2e`、`npm run verify:package`、`npm run verify:migration -- <compact-tool目录>`；迁移补丁 `git apply --check` 通过但未应用。自审发现的断线恢复问题已用先失败、后通过的浏览器测试修复。

最终页面私有内存约 99.3 MB，独立打包服务 RSS 约 57.2 MB；Chrome 共享及辅助进程开销单独报告。详细口径、双轴自审及未验证项见 `docs/verification.md`。日用插件、配置和桌面焦点均未改动。
