---
title: On the Manual Board a desktop left click both taps the permanent AND opens its verb menu
discoveredBy: 2169
status: draft
confidence: medium
---

**What is wrong.** The shared board deliberately does NOT tap a permanent that
also carries activatable abilities — "a permanent that has both a tap and an
ability is never tapped by a stray click" (`src/hooks/useAbilityCardClick.ts:20`),
because on the GRE board the tap is reachable through the mana-ability menu
entry instead. Manual Mode inverts that: EVERY permanent carries the full manual
verb list, and tapping is the primary gesture, so suppressing the click would
leave a manual board with no way to tap at all.

#2169 resolved it with an opt-in policy flag (`clickActsWithAbilities`), which
fires the card's own click AND lets the event reach `ContextMenuTrigger`. The
consequence on desktop is that one left click does two things: the permanent
taps, and the verb menu pops open over it.

That is **exactly** what the deleted hand-written manual board did — `ManualCard`
put its tap `onClick` inside a `ContextMenuTrigger` and never called
`preventDefault` (`manual-board.tsx:774` in the pre-swap file), so the menu
opened on every tap there too. So this is preserved behaviour, not a regression.
It is still arguably poor UX, and now that the affordance is a documented,
named policy rather than an accident it is cheap to change: `preventDefault()`
in the `clickActsWithAbilities` branch of
`src/components/board/board-battlefield-card.tsx` suppresses the menu, at the
cost of leaving desktop with no way to reach the verb list (touch keeps its
action sheet).

**Evidence.** `src/components/ui/context-menu.tsx:44-57` — the trigger
synthesises a `contextmenu` from any left click whose `defaultPrevented` is
false. `src/components/board/board-battlefield-card.tsx` — the
`clickActsWithAbilities` branch calls `onClick?.(e)` without preventing.
`src/hooks/useAbilityCardClick.ts:20-27` — the GRE policy this inverts.

**Why it may not deserve its own issue.** It ships the pre-swap behaviour
verbatim, so nothing a player does today gets worse; and the right fix is a UX
call (which desktop gesture should own the verb menu?) that belongs with #2170's
prompt-to-dialog work rather than as a standalone ticket.
