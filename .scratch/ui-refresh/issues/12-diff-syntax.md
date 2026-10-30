Status: ready-for-agent
Resolution: resolved

# 12: Diff syntax colors

Add `@codemirror/lang-go` and tokenize diff lines with `highlightTree`/`@lezer/highlight`, mapped by extension; unknown extensions stay plain. Keep add/delete row backgrounds and ink; compose word-level highlights where possible. Use the existing syntax tokens. Test Go and an unknown extension. No user-facing toggle.

- [x] dependency and language map
- [x] token rendering with escaping
- [x] word-level composition
- [x] Go/unknown tests
