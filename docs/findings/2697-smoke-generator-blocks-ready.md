---
title: 536 compiled cards are quarantined by the smoke generator's own coverage holes, not by anything about the card
discoveredBy: 2697
status: draft
confidence: high
---

**What is wrong.** `runGates`' fourth gate (`convex/oracle/gates.ts`) runs
`planSmokeTest` and records a `kind: "skip"` as a `smoke-scenario` quarantine
reason. For a HAND-WRITTEN card that is right: the planner skips shapes it
cannot construct precisely because the card's own per-card test covers them
(`convex/gre/effects/scenarioGenerator.ts:791-808`). A COMPILED card has no
per-card test, so the same skip means only "the canned generator cannot build a
scenario for this shape" — and the compiled card is quarantined for a missing
FIXTURE rather than for anything about the card or the engine.

**Evidence.** In the regenerated lockfile (34,890 cards, 1,638 ready / 644
quarantine), the quarantine reasons are dominated by exactly five generator
limitations:

```
238  Op "pump" targets $source/$each — covered by the card's own per-card test
110  Op "grantAbility" targets $source/$each — covered by the card's own per-card test
101  Op "regenerate" registers a dormant regeneration shield (no same-resolution destroy event)
 39  Op "moveZone" changes zones on an object/zone the canned generator does not model
 26  Op "tapUntap" untaps a permanent the canned generator already seeds untapped
 22  Op "counters" targets $source/$each — covered by the card's own per-card test
```

That is 536 of 644 quarantines. Concretely: Psychatog
(`"Discard a card: This creature gets +1/+1 until end of turn."`) compiles
correctly, validates, and is quarantined because the generator does not seed a
source permanent for a `$source` pump. Every self-pump, self-grant and
regenerate card in the corpus is in the same position — the largest single
bucket of Premodern activated text (~115 lines by corpus count).

The generator's gap is narrow and named: `buildScenario` seeds announced TARGET
slots and a library, not the SOURCE permanent, and `moveZone` is skipped for
every shape because the target's starting zone is not modelled.

**Why it may not deserve its own issue.** Quarantine is not a wrong answer — the
gate is honest that it could not prove the definition runs, which is the
fail-closed outcome, and the lockfile records the reason per card. The work is
also not small: seeding a source permanent means teaching the generator the
ability's own source, which is a `scenarioGenerator.ts` change that the whole
catalogue-wide smoke sweep also runs. What argues for a ticket: the number only
grows as #2698–#2700 land (every triggered and static slot emits the same
`$source` shapes), and a `ready` count held down by a fixture is a misleading
headline for the whole PRD.
