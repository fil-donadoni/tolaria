---
title: Popover-based menus (deck-row-menu, app-header-admin-menu) don't carry the ContextMenu 44px-row treatment
discoveredBy: 2731
status: draft
confidence: high
---

**What is wrong.** `src/components/lobby/deck-row-menu.tsx:85-131` and
`src/components/chrome/app-header-admin-menu.tsx` render their verb lists as
`Button variant="ghost" size="sm"` rows (32px, per `buttonVariants`'
`sm: "min-h-[var(--control-h-sm)]"`) inside a `Popover`/`PopoverContent`, with
a `gap-0.5` (2px) column — neither the new `--menu-row-h` (44px) nor
`--menu-row-gap` (4px) tokens issue #2731 introduced for the `ContextMenu` /
`AnchoredPicker` / `ActionSheet` family.

**Why they were left alone.** They are a genuinely different primitive
(`Popover`, not `ContextMenu`), scoped OUT of #2731 by the issue's own
explicit call-out ("`deck-row-menu.tsx` and `chrome/app-header-admin-menu.tsx`
are Popover-based, a different primitive — out of scope"). Re-skinning them
here would widen this PR's diff into a primitive this ticket does not own and
risk a second, uncoordinated pass at the same 44px-row question `Popover`'s
own future slice would need to answer anyway (its trigger is a right-click-free
"more actions" `⋯` button, not the board's card/menu affordance, so it may
reasonably want its own row-height decision rather than inheriting this one
verbatim).

**Why it may not deserve its own issue.** `deck-row-menu.tsx`'s rows are
already a real `Button` (not a bespoke `<div>`+click-handler), so unlike the
four cast-time pickers this ticket collapsed, there is no duplicated
portal/clamp code here to extract — the fix, if wanted, is a one-line size
prop change per call site (`size="sm"` → a new size, or wiring `--menu-row-h`
into `size="default"`'s min-height token directly) once someone decides
Popover menus should match. That is a design call (does a lobby "more
actions" affordance need the same touch-target rung as an in-game menu?), not
a mechanical follow-up, so it reads better as a line item on whichever future
slice touches `Popover`/lobby chrome than as a standalone ticket today.
