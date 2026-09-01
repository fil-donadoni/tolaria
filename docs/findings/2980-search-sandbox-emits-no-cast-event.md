---
title: The ISMCTS sandbox never emits SPELL_CAST, so storm and every other cast trigger is invisible to the search
discoveredBy: 2980
status: draft
confidence: high
---

**What is wrong.** `emitSpellCastEvent` (`convex/gre/state.ts:10884`) is
documented as _"the single choke point every cast goes through"_: it emits
`SPELL_CAST`, maintains `state.spellsCastThisTurn` (the Storm counter, ADR 0052)
and the per-player tallies, and runs `collectCastTriggers` so a keyword-
synthesized cast trigger lands on the stack above the spell. The ISMCTS sandbox
`applyMoveInSearch` (`convex/gre/search.ts`) builds its `StackItem` by hand —
the second of the "TWO independent reimplementations of 'build a StackItem from
a cast'" its own comments name (issue #2473) — and never calls it. So inside the
search tree no cast ever counts, and no cast trigger ever exists.

**Evidence.** Measured on a hand-built position (issue #2980 investigation):
Underworld Breach on the battlefield, Black Lotus and Brain Freeze in the
graveyard, two Islands untapped. Driving the position through
`searchWithTrace` + `applyMoveInSearch`, the Bot escapes the Lotus and then
escapes Brain Freeze — the right play — but `state.spellsCastThisTurn` stays
`undefined` throughout, no storm trigger reaches the stack, and the opponent is
milled 3 instead of 6. Storm counted one prior spell in a real game and zero in
the tree.

**Why it may not deserve its own issue.** The consequence is not a crash or a
freeze: the search simply under-values every storm card and every "whenever you
cast" trigger, which reads as ordinary weak play rather than a bug, and no test
reds. It may also be cheaper to fix as part of collapsing the two stack-item
reimplementations (#2473) than on its own. Against that: the whole storm
mechanic (ADR 0052, PRD #1041) is shipped and the Bot cannot see any of it, and
the same choke point carries `spellsCastThisGame` and the per-player counters
that connive / Ledger Shredder read.
