---
title: The "put into a graveyard from anywhere" trigger condition is now copy-pasted across three cards
discoveredBy: 2319
status: draft
confidence: medium
---

**What is wrong.** Three shipped cards now declare a byte-identical trigger
CONDITION for the Oracle phrase "put into a graveyard from anywhere": the same
four-member `event` array, the same `zone: "graveyard"`, and the same
`matches` predicate discriminating `CREATURE_DIED` on `creatureInstanceId` vs.
the other three on `cardInstanceId`. Only the `effects` differ. The repo's own
convention is closure-on-card-#1, shared helper on card-#2 (CLAUDE.md /
`.claude/rules/gre-development.md`); this is card #3.

**Evidence.**

- `convex/cards/sets/rtr/green.ts:99-155` — `worldspineWurmShuffleFromGraveyard`
- `convex/cards/sets/mbs/colorless.ts:48-99` — `blightsteelColossusShuffleFromGraveyard`
- `convex/cards/sets/roe/colorless.ts` — `emrakulShuffleGraveyardFromAnywhere` (this PR)

The duplication is the CONDITION half only. A
`graveyardFromAnywhereTrigger({ id, oracleText, effects })` factory in
`convex/cards/abilities/triggers/` would absorb all three and leave each card
its own `effects[]` — the same shape `spellCastTrigger` / `enteredTrigger` /
`diedTrigger` already have.

The condition is also easy to get subtly wrong by hand in a way no guard
catches: `PERMANENT_LEFT` is emitted from the same `removePermanentTo` call as
`CREATURE_DIED` (`convex/gre/state.ts:8188-8234`), so a fourth card that lists
both would double-fire on every battlefield death. `triggerDedup.test.ts` only
catches duplicate ABILITIES, not an over-broad event array on one ability. A
factory makes that mistake unreachable.

**Why it may not deserve its own issue.** It is pure hygiene — all three cards
are correct today, and the extraction touches two shipped cards in two other
sets, which is real merge-train conflict surface for zero behaviour change. If a
fourth card in this family is not on the horizon, this is fairly filed as a line
on a refactor tracker rather than a ticket. The argument for doing it is the
double-fire trap above, not the line count.
