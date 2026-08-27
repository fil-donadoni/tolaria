---
title: Three lobby segmented controls hand-roll the radiogroup pattern SegmentedControl now provides
discoveredBy: 2729
status: draft
confidence: high
---

**What is wrong.** `src/components/ui/segmented-control.tsx` (issue #2729)
wraps the v4 `.segment-pill`/`.segment-active`/`.segment-inactive` recipe
(`index.css`, issue #2723) in one accessible `role="radiogroup"` component
with roving-tabindex `ArrowLeft`/`ArrowRight` navigation. Three existing lobby
controls hand-roll the same `role="radiogroup"`/`role="radio"` shape directly
on raw `bg-accent`/`bg-surface-elevated` classes, with click-only selection
and no keyboard roving:

- `src/components/lobby/match-format-selector.tsx:23-53`
- `src/components/lobby/difficulty-selector.tsx:14-56` — byte-for-byte the
  same shape as `match-format-selector.tsx` (radiogroup wrapper class,
  per-segment `bg-accent`/`bg-surface-elevated` ternary, no `onKeyDown`)
- `src/components/lobby/play-mode-selector.tsx:44-79`

None of the three is on this issue's declared target-file list
(`src/components/board/*dialog*.tsx`, `cards-pile.tsx`, `game-over-dialog.tsx`,
`pregame-dialog.tsx`, `cast-cost-dialog.tsx`, `lobby/*dialog*.tsx`,
`ui/game-dialog.tsx`), and another session's batch could plausibly be editing
them concurrently — so #2729 does not touch them, per its own scope decision.

**Evidence.** `match-format-selector.tsx:29-53` builds the group and each
segment by hand:

```tsx
<div role="radiogroup" aria-label="Match Format" className="inline-flex overflow-hidden rounded-sm border border-border-subtle/40">
    {OPTIONS.map((opt) => (
        <button role="radio" aria-checked={selected} onClick={() => onChange(opt.value)} className={...}>
```

No `onKeyDown` — arrow keys do nothing, which is the one part of the
WAI-ARIA APG radio-group pattern a hand-rolled copy silently drops (and the
part `SegmentedControl`'s own test suite,
`src/components/ui/__tests__/segmented-control.test.tsx`, exists specifically
to guard). `play-mode-selector.tsx:44-79` repeats the same shape, plus a
`Tooltip` wrapper per segment that `SegmentedControl`'s current API has no
slot for.

**Why it may not deserve its own issue yet.** Migrating three call sites is a
small, mechanical refactor with no user-visible behavior change other than
adding keyboard support — plausibly a "good first slice" rather than a
standing ticket. The one design question worth resolving before filing:
`play-mode-selector.tsx`'s per-segment tooltip means `SegmentedControl` may
need a `renderOption`/tooltip slot, or that caller stays hand-rolled on
purpose. Worth a line on a UI-identity tracker (ADR 0103's PRD #2721 family)
rather than a fresh issue, unless the tooltip question turns out to matter
more than it looks here.
