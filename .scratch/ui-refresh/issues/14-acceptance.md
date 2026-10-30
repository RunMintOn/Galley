Status: ready-for-human
Resolution: headless verification passed; `dist-desktop` rebuilt after the user approved stopping the old service (2026-10-30)

# 14: Test and acceptance

Update visual/behavior tests for English labels, two-line rows, type colors, layout, and syntax spans. Add focused coverage for resizers (drag/keyboard/double-click/persist/min), settings sync across windows, source toggle, path elision, and Go/unknown syntax fallback. Run `check`, `e2e`, `visual`; compare 1440/1050 dark/light with the mockup and the editor window. Rebuild the daily app only after the user approves stopping it.

- [x] behavior tests
- [x] visual screenshots
- [x] before/after comparison
- [x] desktop build after approval
