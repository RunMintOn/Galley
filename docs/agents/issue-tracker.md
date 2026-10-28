# Issue tracker: Local Markdown

本项目的规格和任务使用本地 Markdown，不调用远端 issue tracker。

## Conventions

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 规格：`.scratch/<feature-slug>/spec.md`。
- 实现任务：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号，每个任务独立一个文件，不合并为单一任务清单。
- 规格和任务的 triage 状态在文件顶部以 `Status:` 记录，状态词见 `triage-labels.md`。
- 评论和讨论追加在文件末尾的 `## Comments` 下。

技能要求“发布到 issue tracker”时，在上述位置创建或更新文件。要求“获取任务”时，读取用户指定的文件；用户只提供编号时，在相关功能的任务目录定位。

## Wayfinding operations

供 `/wayfinder` 使用；map 是总览，每个问题或任务独立成文件。

- Map：`.scratch/<effort>/map.md`，保留 Notes、Decisions-so-far、Fog。
- 子任务：`.scratch/<effort>/issues/NN-<slug>.md`，正文记录问题；`Type:` 为 `research`、`prototype`、`grilling` 或 `task`。
- Wayfinding 的执行状态以 `Status:` 记录：未领取为 `open`，领取为 `claimed`，完成为 `resolved`。这是执行状态，不是 triage 状态。
- 依赖：文件顶部 `Blocked by: NN, NN`；所列文件全部 `resolved` 后才解除阻塞。
- Frontier：扫描对应任务目录，选择未阻塞、未领取的开放任务，编号最小者优先。
- Claim：工作前写入 `Status: claimed`。
- Resolve：在 `## Answer` 追加结果，设置 `Status: resolved`，并在 map 的 Decisions-so-far 中加入摘要和链接。
