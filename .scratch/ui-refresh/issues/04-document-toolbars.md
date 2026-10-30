Status: ready-for-agent
Resolution: resolved

# 04: Document toolbars

Content header stays tabs, path, counts, collapse. Add one 34px document toolbar: diff gets Unified/Split, Wrap, Open file; Markdown file gets Source/Split/Preview, Edit/Save/Reload, status; nested Git diff uses the same toolbar component. Remove diff controls from the header and Wrap from the footer; footer keeps position and `j / k`. Keep the round request/capture block above the diff, below the toolbar, with its timestamp as the only time display.

- [x] shared toolbar rendering
- [x] move diff controls out of content header
- [x] file toolbar and status
- [x] nested Git toolbar
- [x] round context restyle and dedupe time
