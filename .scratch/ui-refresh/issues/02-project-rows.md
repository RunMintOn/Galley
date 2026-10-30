Status: ready-for-agent
Resolution: resolved

# 02: Project rows

Two-line rows: name + branch + count on line 1; left-elided location (`…/last-two-segments`) on line 2 with the full path in `title`. Omit the branch when unavailable; remove the repeated "not a Git repository" copy. Working dot only when working. Container queries: below 205px hide location and use 38px rows; below 170px hide branch. Keep one Add folder entry, the project menu, and a working move/remove.

- [x] two-line grid and deterministic path tail
- [x] branch loading without placeholder copy
- [x] narrow container states
- [x] header add entry only; remove old list add and ⌘O hint
