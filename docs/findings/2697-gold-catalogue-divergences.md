---
title: The gold harness found four hand-written cards that disagree with their own Oracle text — one of the four deliberately
discoveredBy: 2697
status: draft
confidence: high
---

**What is wrong.** The Oracle compiler's activated-ability slot (#2697) now
compiles 122 of the 376 activated-only gold cards. 118 round-trip exactly. Of
the four that do not, **three are defects on the HAND-WRITTEN side** — the
compiler's reading is the CR-faithful one — and the fourth is an encoding tie.
They are enumerated in `KNOWN_DIVERGENCES`
(`convex/oracle/__tests__/gold.test.ts`), which is what keeps the suite green;
none of them is fixed here, because this issue's diff is `convex/oracle/**` plus
the lockfile and each fix changes a card's behaviour.

**Evidence.**

1. **Northern Paladin** (`convex/cards/sets/lea/white.ts`) — Oracle:
   `"{W}{W}, {T}: Destroy target black permanent."` The hand-written
   `targetRequirement` is `{ colorFilter: "B", count: 1, type: "Creature" }`.
   CR 109.1 / 300.1: a permanent is any of the six permanent card types, so the
   card as shipped cannot destroy a black artifact or enchantment. The compiler
   emits `type: ["Artifact","Battle","Creature","Enchantment","Land","Planeswalker"]`.

2. **Wall of Brambles** — its own `oracleText` prints
   `"{G}: Regenerate this creature."` and the definition carries **no
   `activatedAbilities` at all**; its whole behavioural projection is
   `{ staticAbilities: ["defender"] }`. The ability is simply missing. (This is
   also why `keyword-only` had to leave the "100% bucket" loop in
   `gold.test.ts` — the bucket is classified from the hand-written side.)

3. **Ashnod's Altar** — Oracle: `"Sacrifice a creature: Add {C}{C}."` The
   hand-written ability is `useStack: true` with an `addMana` Op. CR 605.1a:
   it requires no target, could add mana, is not a loyalty ability and neither
   its cost nor its effect moves a card to or from a library — so it IS a mana
   ability and must not use the stack (CR 605.3a).

    **This one is a DELIBERATE, documented deviation, not a defect — do NOT
    "fix" it by flipping `useStack`.** `convex/cards/sets/atq/red.ts:163-180`
    carries a box comment naming the exact reason: the engine's non-stack mana
    path has no step that pays a `sacrificeFilter`, so the card is modelled on
    the stack to reuse the sacrifice-choice machinery, at the known price that
    its mana is not available mid-cast. Priest of Yawgmoth is deviated the same
    way and for the same reason. Flipping either to `useStack: false` today
    makes the ability payable without paying its cost — see the sibling finding
    `2697-mana-ability-filter-cost-engine-gap.md`, which is where this belongs
    as work. The compiler's READING is still the CR-faithful one; the catalogue
    is right to disagree with it until the engine can honour the reading.

4. **Horror of Horrors** — `sacrificeFilter: { types: "Land", subtypes: "Swamp" }`
   for `"Sacrifice a Swamp"`, where Dark Heart of the Wood, Orcish Lumberjack
   and Deadapult write the same phrase shape as `subtypes` alone. Not a
   behaviour difference — a restatement of what CR 205.3i already implies. Only
   listed because the projection compares encodings, not meanings, once the
   documented string/array and `{0}` shorthands are canonicalised.

**Why it may not deserve its own issue.** (4) is cosmetic and could be closed by
picking a house style for subtype-only filters rather than by a ticket. (1) and
(2) are real rules bugs, but each is one card and neither is in a Tier-1 deck,
so they may belong as two lines on a catalogue-audit tracker rather than as two
issues. (3) is not a catalogue ticket at all — it is a deliberate deviation
whose retirement is gated on the engine gap in the sibling finding, and touching
the card before that gap closes is a regression. What argues for tickets anyway:
(2) means a shipped card silently does nothing for its `{G}` — the "passes its
own tests, plays wrong" shape — and it was invisible until a second reader (the
compiler) was pointed at the same Oracle text.
