# Review Console UI proposal

Static HTML mockup. The real app was not modified.

Current detail pass: three-line Git projects, right-click Remove, Git history
with relative times and bottom-right counts, custom ref menu, dismissible
notice, and content/reply collapse. Use the bottom bar's No changes / Clean Git /
Non-Git / Notice buttons to preview states. These are review controls, not product settings.
These newer decisions supersede the older two-line and inert-collapse notes below.

Open `index.html` directly in a browser, or:

```sh
open .scratch/ui-refresh/mockup/index.html
```

`preview-*.png` are 2x screenshots of the same page for quick comparison.

## What to try

- Drag any of the three pane dividers. Double-click a divider resets all widths.
  Focus a divider and use the arrow keys for the keyboard path.
- Click the sliders icon in the reply header for the combined view settings
  (theme, paper, prose font, Markdown preview preference).
- Use the bottom bar for the side-by-side options: Dark/Light,
  Project path (two-line rows on/off), Type color (file-type tints,
  on by default), Syntax colors (diff token colors, on by default),
  and Review notes (hover a note to highlight the area it describes).
- Click `Git` in the content header, `>` in the reply nav (reply source),
  and `Reply` (composer) to see the other modes.

Some controls are intentionally inert in the mockup: pane collapse, Unified/Split
content, the open-file button, and the file tree. The page is about placement,
shape and state, not behavior. The mockup also omits existing app controls
(round time/Tree toggle, file status, Git workspace groups, Back to latest,
send state). They are not features to delete; see `../spec.md` Preserve.

## Boundaries

Unchanged from the app: palette, type scale, four-pane layout, diff add/delete
colors, reading measure and typography, keyboard shortcuts.

Changed in this proposal: header icons and their order; project rows are two lines, name and branch on top, the location below, elided from the left with the full path on hover; no top gap above the first list row, the selected fill and 2px marker touch the header border;
file-type glyphs; diff control placement; hunk bar; reply header identity;
reply actions placement; settings consolidation; selected/hover/focus/pressed
states; checkboxes and pickers; all three dividers; light-mode hairline
contrast; all-English UI copy; orphan control in prose.

## Decisions already taken

- All-English UI, including menus and tooltips.
- File icons: type tint on by default; `Type color` turns it off.
- Diff syntax colors: in scope; `Syntax colors` turns the preview off.
- Project rows: two lines with the location; `Project path` shows the
  one-line fallback. The location is universal (most projects are not Git,
  so a branch-only line would be empty for most rows); the branch stays on
  the name line.

No design decisions open. Implementation ambiguities are in `../handoff.md`.
