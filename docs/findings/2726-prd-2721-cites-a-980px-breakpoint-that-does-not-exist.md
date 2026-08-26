---
title: PRD #2721's lobby slice cites a 980px breakpoint that exists only in the prototype
discoveredBy: 2726
status: draft
confidence: high
---

**What is wrong.** Issue #2726's body (and, by inheritance, the PRD #2721 text
it was cut from) specifies "≤980px stacks tiles/loadout/shelves under the
bottom nav". There is no 980px breakpoint anywhere in the shipped app. The
number is the prototype's own media query and nothing else; implementing
against it would have put the stacking threshold ~213px above the band where
the bottom nav actually appears, so a 900px-wide tablet would have stacked to
one column while still wearing the desktop top bar.

**Evidence.**

- `git show prototype/identity-v4:src/components/prototype/identity/identity.css`
  — `@media (max-width: 980px)` is where every `.pm-*` stacking rule lives. The
  prototype is a standalone route with no `AppShell` around it, so it invented
  its own threshold.
- `src/hooks/useViewportMode.ts:19` — `PORTRAIT_QUERY = "(orientation:
portrait) and (max-width: 767px)"` (Tailwind `md`), and `:32-33`
  `LANDSCAPE_COMPACT_QUERY = "(orientation: landscape) and (max-height:
500px)"`. These two are what `src/components/chrome/app-shell.tsx:48-52`
  reads to decide bottom nav vs top bar.
- Nothing in `src/**` matches `980`: the app's layout breakpoints are Tailwind's
  (`sm` 640 / `md` 768 / `lg` 1024) plus the two media queries above.

#2726 was implemented against the real thresholds (`sm:` for the tile grid,
`lg:` for the Mode Tiles | Loadout split), and says so in its PR body.

**Why it may not deserve its own issue.** It is a documentation defect in one
sentence of one issue body, already worked around, and #2726 is the only child
of #2721 whose body carries it. If the remaining identity-v4 slices (#2727–#2734)
repeat the number it becomes worth a single edit pass over the PRD; if they do
not, this file is the whole record.
