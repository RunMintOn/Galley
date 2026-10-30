Status: needs-triage

# 文件生命周期与 Finder
原生文件对话框、读取保存、另存为、文件关联、多标签、修改标记、关闭保存选择、外部修改提示。

## 实现结果
已实现于 `desktop/documents.go`、桌面菜单与 `web-src/scratch.js`。另存为保留原图片位置、调整相对引用。Go 文件读写/冲突、网页 IPC 流程、原生保存面板取消与落盘、再次保存、已运行实例的 macOS 文件打开事件均通过。Finder 冷启动尚未单独验收。
