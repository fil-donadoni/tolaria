---
title: enumerateTargetTuples calls getLegalTargets with isSpell=true even for activated abilities, disagreeing with the mutation
discoveredBy: 2399
status: draft
confidence: medium
---

**What is wrong.** The bot's target enumerator builds its `TargetingSource` with
`isSpell: true` unconditionally. The human/mutation path builds the SAME
ability's source with `isSpell: false` (CR 113.3 — an activated ability is not a
spell). Any target filter that reads that dimension — protection from spells,
"can't be the target of spells", a `spellStackKind` gate — therefore answers
differently for the bot than for the server on the identical activation.

**Evidence.**

```
convex/gre/moves.ts:532   (enumerateTargetTuples)
    const legal = getLegalTargets(
        state,
        effReq,
        // moves.ts enumerates legal targets for casting a spell from hand, so
        // the source is always a spell (vs an activated ability). …
        targetingSourceFromCard(card, true),
```

```
convex/game.ts:13153      (activateAbilityOnState)
    const legal = getLegalTargets(
        state,
        effectiveTargetReq,
        // CR 113.3 — the source is an activated ability, not a spell.
        targetingSourceFromCard(card, false),
```

The comment at `moves.ts:532` was accurate when written — the function only
served the cast-from-hand path — but `enumerateAbilityMoves` (`moves.ts:1329`)
now reuses it for activated abilities, so the comment is stale and the flag is
wrong for that caller. Direction of the error: the bot sees FEWER legal targets
than the server allows (a permanent with protection from spells is filtered out
of the bot's tuples but is a legal pick for the ability), so it under-enumerates
rather than proposing an illegal pick — a missed line, not an ADR 0047 freeze.

**Why it may not deserve its own issue.** No shipped card is known to reach the
divergence: it needs a protection-from-spells (or spell-only ward) permanent on
the board at the same time as a targeted activated ability, and the catalogue's
protection cards are mostly colour-scoped rather than spell-scoped. The fix is
one boolean plumbed through `enumerateTargetTuples`, which is small enough to
ride along with the next change in that function rather than earning a ticket —
but it should not be lost, because the failure is silent and the stale comment
actively argues the current behaviour is correct.
