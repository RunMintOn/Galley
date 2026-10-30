# Handoff: Review Console UI refresh (implementation)

**Date:** 2026-10-30
**Repo:** `~/20-dev/10-projects/33-lite-editor`
**Branch / HEAD:** `integration/review-console-redesign` @ `17a78cc`
**Worktree:** app source untouched. `docs/development.md` has the `test:visual` build note. `.scratch/ui-refresh/` is untracked (spec, handoff, mockup).
**Baseline:** the installed `dist-desktop/Review Console.app` was built before HEAD. Rebuild after the change. Do not use the installed app as the source baseline.

## Goal

Implement the approved UI refresh in the real app. The user likes the current style; this is a **control and detail pass**, not a redesign. Keep the palette, type scale, four-pane layout, diff add/delete semantics, reading measure, and shortcuts. Make the review console and the Markdown editor feel like one product.

Decisions already taken by the user:

- **All-English UI**: menus, titles, tooltips, aria-labels, empty states, notices, confirms, native error dialog. Content (agent replies, commit subjects, paths, dates) keeps its own language. README/docs can stay Chinese.
- **File icons**: one document glyph, with a type tint on by default. No per-type shapes, no text glyphs such as `↓` / `go` / `{}`.
- **Diff syntax colors**: in scope. The diff keeps the green/red add/delete row semantics and adds token colors. Go needs a new grammar dependency.
- **Project rows**: two lines. Name + branch + count on line 1; location on line 2. The location is left-elided with `…/`, never tail-truncated; full path in the title. Below 205px the location hides and the row returns to one line; below 170px the branch hides too.
- **No gap above the first list row**: the selected row's fill and 2px marker must touch the pane header's 1px bottom border, in both the projects pane and the changed-files list. This was the user's last annotation.

## Where the design lives

The approved mockup is the visual spec:

- `.scratch/ui-refresh/mockup/index.html` — open it. The bottom bar has comparison toggles. `Review notes` lists the 13 numbered changes and highlights each target on hover.
- `.scratch/ui-refresh/mockup/README.md` — boundaries, what to try, decisions.
- `.scratch/ui-refresh/mockup/preview-*.png` — dark, light, narrow (1050), popover, composer, Git, source, ivory, one-line, resized, notes, colors-off.
- `.scratch/ui-refresh/mockup/styles.css` and `mock.js` — target tokens, shapes, and resizer logic. **Do not copy them wholesale into the app.** Translate the rules into `web-src`.

The mockup is a static visual reference with fake data. It is **not** a feature list. See "Preserve" below.

## Read first

- `AGENTS.md`, `docs/development.md` (build, tests, desktop permissions, update order).
- `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.
- `web-src/app.js`, `web-src/index.html`, `web-src/style.css`, `web-src/reply.css`, `web-src/reply.js`, `web-src/diff.js`, `web-src/git-view.js`, `web-src/theme.js`, `web-src/editor.js`, `web-src/scratch.html/js/css`.
- `desktop/main.go`, `desktop/startup.go`.
- `test/visual.mts`, `test/redesign.mts`, `test/polish.mts`, `test/editor.mts`, `test/diff-fold.mts`, `test/desktop.mts`.

The spec is `.scratch/ui-refresh/spec.md`; extend it and create issues from the mockup's Review notes, following the repo's tracker. Link the mockup. This handoff is the implementation brief; the mockup is the visual contract.

## Change map

### 1. Shell and resizers

- Default projects width 196 → 210. Project row 54 → 48 (two lines). File row 28, tree row 26, header 40, document toolbar 34, footer 28. Reply header 48 → 40.
- All three boundaries drag: projects/files, files/content, content/reply. Reuse the existing reply-resizer pattern and `layoutPanes()`; do not add a parallel layout path. Add persisted widths (`review-projects-width`, `review-files-width`; keep `review-reply-width`), double-click reset, arrow keys when focused, `aria-valuenow/min/max`, and clamp the content to its 280px minimum. Hide or disable the relevant handle when a pane is collapsed. Change the existing reply-resizer hover from the 8px tinted bar to the mockup's 1px accent line.
- Remove any top padding or margin above the first row in the projects and changed lists. The selected row's background and 2px left marker must start directly below the header border.
- Keep the pane collapse behavior; the new handles must not break it.

### 2. Projects

- Two-line rows: name, branch, and count on line 1; location on line 2. Remove the repeated "non-Git repository" text. Keep a working dot only when working.
- The location is `project.root`'s tail, left-elided (`…/last-two-segments`), full path in `title`. Never tail-truncate. A deterministic last-two-segments helper is enough; no measurement is required at the 210px default. If the branch data is unavailable, omit it; do not invent one.
- At container widths below 205px hide the location and collapse to 38px; below 170px hide the branch too. The app's existing `@media (max-width:1160px)` sets the projects width to 140, so the narrow state will apply there.
- Keep the project menu and exactly one add-folder entry. If the old `⌘O` hint remains on the add entry, fix it: on desktop `⌘O` opens Markdown, not a project.
- The mockup uses fake project names and roots. Use the real project model in `src/server.ts` / `src/files.ts`; do not hard-code fixture paths.

### 3. File icons and type color

- Replace the text glyphs in `fileButton` (`↓`, `JS`, `TS`, `{}`, `#`, `‹›`, `go`, `▧`, and the generic SVG mix) with one 16px document outline (stroke 1.3). The Markdown 20px arrow must go.
- Add a `data-type` tint, on by default: markdown / code / config / image. The dark and light palettes are in the mockup CSS. Keep the line counts and the green changed dot.
- Use the same glyph and size in the changed list and the file tree. Unify the current 11.5px mono (changed) versus 13px UI (tree) file names to one size (the mockup uses 12.5 UI).
- The selected row keeps the type tint; the selected state is the background + 2px marker, not a color change.

### 4. Headers and controls

- One icon set and order: secondary action, primary action, collapse. 24px hit area, 16px stroke icons. Replace `⋯`, `＋`, `×`, `‹ ›`, and the down-arrow glyphs with the mockup's SVG set where the meaning is the same.
- One control vocabulary: text button, icon button, segmented control. 4px radius for controls, 8px for popovers/cards, 0 for list rows. One focus ring (1.5px inset), one hover, one pressed (1px translate), one custom checkbox. No `transition: all`, no layout animation.
- One current-item treatment: 2px neutral marker + fill. Green only means added or running, not "current". The commit row's green left bar becomes the neutral accent.
- **Document toolbars:** every document fills one toolbar. The diff toolbar holds Unified/Split, Open file, and Wrap. The Markdown file toolbar holds Source/Split/Preview plus Edit/Save/Reload and the file status. The nested Git diff uses the same toolbar component. The content header stays stable: Review/Git tabs, path, counts, collapse. Remove the round-diff controls from `#content-actions` and `wrap` from `#content-footer-actions`; the footer keeps the position and `j / k`.
- The hunk bar: range on the left, change count on the right; remove the decorative `@@`. Translate `hunk`, `changes`, `show/hide`, `N unchanged lines`, and the no-diff notice.
- **Settings:** one popover per window for theme, paper, prose font, and default preview. Remove the reply header's inline font/paper/theme, the content header's dots menu, and the editor toolbar copies. The popover is the same component in both windows; the existing localStorage keys and `storage` sync must keep working. The default preview preference stays shared.
- **Reply header:** remove the "Visual Reply" wordmark and the "Text-native visual replies for Pi" subtitle. Show `Reply` plus the reply's first heading as context (fallback to the session name). Right side: settings + collapse.
- **Reply nav:** session pick, pager, status, spacer, source icon, `Reply`. Remove the redundant "Latest reply" label; keep "Back to latest" when browsing an old round. At narrow widths hide the status text/connection and shorten the session pick; never truncate it back to `proj-a-mayoi · v_`. The mockup's label is a fixture; the rule is readable width.
- **Source:** remove the reply-header `Show source`; use the code icon in the nav with `aria-pressed` and a tooltip that keeps `⌘↵`. The content header shows `Reply source`; the source toolbar has `Temporary preview · not written to disk` and a close; hide the content footer in source mode. Keep the temporary-preview editing behavior, the `Cmd+Enter` shortcut, and the return-to-file behavior.
- **Composer:** `Reply` toggles it; placeholder `Continue the conversation…`; caption `Enter to send · Shift+Enter for a new line`; filled `Send`; keep the send state.
- The mockup's segmented controls replace native selects where the option count is 2–3 (theme, paper, font); keep native selects where a long list needs one (sessions, rounds, refs). Do not turn every picker into a popover.

### 5. Diff syntax colors (new)

- Add `@codemirror/lang-go` (6.0.1 exists; `@lezer/go` is available) alongside the existing JS/Markdown languages.
- Use `highlightTree` / `@lezer/highlight` with the existing syntax tokens; map by file extension; unknown extensions fall back to plain. Apply in `mountDiff` in `web-src/diff.js`.
- Preserve the add/delete background and ink and the word-level highlights if they compose. If token spans and the word-level diff conflict, keep the row-level add/delete semantics and the syntax colors; do not ship half-tokenized HTML. The mockup has no word-level highlights, so losing them is acceptable only if the alternative is broken markup.
- The hunk/file-head/notice copy goes English. Test Go and an unknown extension.
- `Syntax colors` is on by default in the product; the mockup's toggle is a review control, not a user setting.

### 6. Editor window

- Not mocked. Apply the same control language, English copy, icon set, and settings popover (including default preview). Remove the inline font/paper/theme and the duplicated preview checkbox from the toolbar. Keep the tab rename, source/split/preview, diff tab, CodeMirror behavior, and save/conflict flows.
- Do not restructure the editor's toolbar/tabs/doc-bar rows without showing the user a screenshot first. The mockup only covers the console.

### 7. English copy and native surfaces

- Translate all UI strings in `web-src` and `desktop/main.go` / `desktop/startup.go`: menus, titles, tooltips, aria-labels, empty states, notices, confirms, the startup error dialog. Keep `Git`, `HEAD`, `Blame`, `pi`.
- Menu titles File / Edit / View / Window; translate the custom items. Standard roles (Cut/Copy/Paste) are OS-localized.
- Do not translate user data. Dates may stay locale-formatted. README/docs can stay Chinese.

### 8. Light mode

- Solid hairlines (`#dedede` in the mockup) instead of 8% alpha. `--subtle` dark `#8b8b94`, light `#686868` for readable tertiary text. Keep the rest of the palette.
- Reply headings use ink in both themes; the yellow link underline is the reading accent. Add `text-wrap: pretty` to prose paragraphs (progressive enhancement; keep normal wrapping if unsupported).

## Preserve (the mockup omits these)

The mockup is static and omits existing controls. Keep these behaviors and restyle them; do not delete them:

- Round time and Tree/Flat toggle (hide Tree when there are 0 changes), file status / UTF-8, send state, "Back to latest", project menu and add entry, Git refs / workspace groups / commit list / blame / paging, preview-preference sync across windows, reply paper / ivory / serif options, source temporary-preview editing, all keyboard shortcuts and scroll behavior.
- If a placement is unclear, keep the function and ask the user. Do not silently remove a feature because the mockup does not show it.
- Do not touch the old compact-tool / visual-reply migration, the user's pi configuration, or the user's real project data.

## Verification

- Read `docs/development.md` first. Use isolated data dirs (`REVIEW_CONSOLE_STATE`); never point tests at the user's real projects.
- Baseline: `npm run check`, `npm run test:e2e`, `npm run test:visual`; regenerate `test-results/ui` after `npm run build`.
- Update the visual/behavior tests for the English labels, two-line rows, type colors, new layout, and syntax spans. Add focused tests for the resizers (drag, keyboard, double-click, persist, min), settings sync across windows, the source toggle, path elision, and the Go/unknown syntax fallback. The visual fixture is Go; it exercises the highlighter.
- Compare the real app with `.scratch/ui-refresh/mockup/preview-*.png` at 1440 and 1050, dark/light, plus the editor window. The mockup is a target, not a pixel baseline.
- `npm run build:desktop` and let the user open the daily app. Desktop tests open windows and change focus; ask the user before `npm run test:desktop` per `docs/development.md`. Follow the stop / build / open order if the app or service is running.
- Show the user before/after screenshots and let them open the app for the final visual check.

## Open points

- The editor window's row structure is not mocked; only unify controls/settings/copy unless the user approves a structural change.
- The project branch may be unavailable for some projects; omit it rather than fake it. The location line is the universal second line.
- The real session names differ from the mockup fixture. The rule is readable width, not the exact string.
- The mockup's `Project path` / `Type color` / `Syntax colors` toggles are review controls. Type color and syntax colors are on by default in the product; no new user-facing toggles unless the user asks.

## Suggested skills

- **`ui`**: required before changing any surface. Use the mockup as the reference and the screenshot iteration / quick-fix modes; verify the real rendered app at the supported widths and both themes. The direction is locked by the mockup; do not re-run a new direction search.
- **`tdd`**: use for the resizer behavior, settings sync, source toggle, path elision, and diff highlighter. Write the failing test first where the behavior is non-visual.
- **`code-review`**: optional final pass of the diff against the mockup and the repo standards, using `17a78cc` as the fixed point.
- **`playwright-cli`** only if the existing `test:visual` harness cannot inspect what you need; prefer the repo fixtures.

## First steps

1. Read the mockup, its README, and the Review notes. Open `preview-dark.png` and `preview-narrow.png` side by side with the current `test-results/ui/01-review.png` and `10-narrow.png`.
2. Extend the spec and create the issues; list the work in the repo's tracker.
3. Capture the current app screenshots as the before state (headless, isolated).
4. Implement the shared tokens/icons/controls first, then the shell (resizers, project rows, file icons), then content/diff/source, then reply/settings, then the editor window and English copy. Keep each stage runnable.
5. Ask the user only about implementation ambiguities (editor structure, omitted-feature placement). The visual direction is approved.
