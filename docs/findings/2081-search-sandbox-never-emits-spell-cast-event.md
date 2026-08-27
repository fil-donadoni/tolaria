---
title: Neither search sandbox calls emitSpellCastEvent — "whenever you cast a spell" triggers (including SPELL_KICKED) are invisible to the Bot's own simulation
discoveredBy: 2081
status: draft
confidence: medium
---

**What is wrong.** `applyMoveForSearch`'s and `applyMoveInSearch`'s
`"cast-spell"` cases (`convex/gre/applyMove.ts`, `convex/gre/search.ts`) build
a `StackItem` and push it directly onto `state.stack`, never calling
`emitSpellCastEvent` (`convex/gre/state.ts:10137`) — the single choke point
that raises `CARD_CAST`/`SPELL_KICKED` events and lets trigger-scan pick them
up. Both real commit paths in `game.ts` call it. This predates issue #2081
(the two sandboxes have been a parallel, deliberately-scoped "build a
`StackItem`, skip the effect" reimplementation since #2473) — #2081 only
confirmed the gap still exists while wiring the Kicker payment through both
sandboxes, since a kicked spell's `SPELL_KICKED` event (Saproling Infestation,
`inv/green.ts`'s "whenever a player kicks a spell" trigger) is exactly the
kind of thing this choke point would raise.

**Evidence.** `grep -n "emitSpellCastEvent" convex/gre/applyMove.ts
convex/gre/search.ts` returns nothing; `convex/game.ts` calls it at 4 sites
(3858, 7390, 8611, 9071).

**Why it may not deserve its own issue on its own.** This is not
Kicker-specific — it is EVERY "whenever you cast a spell" trigger (storm
count, Guttural Response-shaped triggers, cast-a-spell payoffs generally)
going unseen by the search's own 1-ply/rollout simulation, a much larger
scope than this issue's mandate (charging a cost the enumerator promises).
Fixing it properly means deciding whether the sandboxes should run full
trigger-scan-and-resolve for a cast (a meaningfully bigger change to two
performance-sensitive hot paths) or take a narrower, targeted fix — a design
question, not a one-line add. Worth a deliberate PRD/issue of its own rather
than a drive-by fix inside #2081.
