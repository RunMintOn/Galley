Status: ready-for-agent
Resolution: resolved

# 01: Shell and resizers

Default projects 210, files 248, reply 470; header 40, document toolbar 34, footer 28; project row 48, file row 28, tree row 26. All three dividers drag, persist (`review-projects-width`, `review-files-width`, `review-reply-width`), support arrow keys, double-click resets all widths, clamp content to 280, hide the handle when either adjacent pane is collapsed. Hover is a 1px accent line, not an 8px tint. Remove top padding above the first projects/changed row. Keep pane collapse and the existing `layoutPanes()` path.

- [x] three resizers with shared drag/keyboard/reset behavior
- [x] persisted widths and min clamps
- [x] collapsed-pane handles hidden
- [x] flush first rows
