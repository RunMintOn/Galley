Status: ready-for-agent
Resolution: resolved

# 07: Reply actions, source, composer

Nav order: session pick, pager, Back to latest, status, spacer, source icon, Reply. Remove the "Latest reply" label. Source icon carries `aria-pressed` and keeps `⌘↵`; content header shows `Reply source`; source toolbar shows the temporary-preview note and close; hide the content footer in source mode. Keep temporary-preview editing and return-to-file. Composer: Reply toggles it; placeholder, caption, filled Send; keep send state. Narrow widths hide status/connection and shorten the session pick without a useless truncation.

- [x] nav order and responsive rules
- [x] source mode header/toolbar/footer
- [x] composer and send state
- [x] latest/status/temporary-preview states
