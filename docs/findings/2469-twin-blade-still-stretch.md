---
title: enumeration fixed the combo-activation blade entry's legal-move gap, but the search still passes on it 3/5 seeds
discoveredBy: 2469
status: draft
confidence: medium
---

**What is wrong.** `enumerateAbilityMoves` (`convex/gre/moves.ts`) now reads
`getEffectiveActivatedAbilities` (issue #2469), so the blade entry `combo:
activates Splinter Twin on enchanted Deceiver Exarch`
(`convex/gre/ai/blade/registry.ts:1687-1722`) has its expected move
(`activate-ability` on Deceiver Exarch) genuinely enumerated for the first
time. It is still `stretch`, not `must`: at the entry's declared budget
(`iterations: 400`), the search chooses `pass` on 3 of its 5 seeds (`727774`
aka `0xb1ade`, `2`, `3`) and the activation only on 2. The gap moved from
"the move doesn't exist" to "the search doesn't value it enough."

**Evidence.** `bun run test:blade` with the entry temporarily promoted to
`must`:

```
AssertionError: seed 727774: chose [pass] — expected one of
[activate-ability card=Deceiver Exarch]; seed 2: chose [pass] — expected one
of [activate-ability card=Deceiver Exarch]; seed 3: chose [pass] — expected
one of [activate-ability card=Deceiver Exarch]
```

**Why it may not deserve its own issue yet.** The registry entry's own note
already documents this precisely (label, seeds, cause) and stays `stretch`,
which is the correct classification per the blade doctrine (report-only,
non-blocking) until someone actually improves the valuation. The likely fix
is `comboAnnotations.ts` combo-payoff scoring or a deeper search horizon for
this shape — both explicitly OUT OF SCOPE for #2469 (which is enumeration
only). Whether this deserves its own ticket depends on whether the same
"combo activation scores near `pass`" shape recurs on other combo blade
entries once they, too, become reachable through granted-ability
enumeration — worth re-checking the next time a combo-shaped card is worked,
rather than opening a ticket for one still-`stretch` entry today.
