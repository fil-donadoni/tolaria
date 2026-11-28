---
title: the evaluation's mana term prices a renewable mana source by count, not by yield
discoveredBy: 9838
status: draft
confidence: medium
---

**What is wrong.** `manaSourceTermFor` (`convex/gre/evaluate.ts`) prices each
renewable mana source at `manaWeight` / `tappedManaWeight` per permanent, never
by what one activation nets. A land tapping for {G}{U} (Simic Growth Chamber),
Sol Ring, Ancient Tomb or Gilded Lotus reads exactly like a Forest on every
ISMCTS leaf; the difference only shows once a rollout reaches a turn where the
extra mana is spent.

**Evidence.** On the blade entry `bounce land: Simic Growth Chamber taps the
other land before returning it`, the two end-of-turn leaves (Elves cast, Chamber
kept / Elves cast, Forest kept) scored identically term for term (`mana` 23.6
both) before the root-clock horizon landed. The entry now passes 10/10 at 200,
400 and 800 iterations, ROBUST, but by `material-tiebreak`: the horizon lets the
margin see the next turn, the leaf evaluation still does not.

A built yield term exists, unlanded: `exp/issue-9838-yield-term` (`f8a0fea75`,
based on a November-16 base) adds `netManaYield`
(`convex/gre/manaAvailability.ts`) and multiplies a floored yield into the
per-source price at `manaSourceTermFor`, `returningManaSourcesTerm` and the
`permanentRealisedValue` lens. Measured on its own base it separated the
Chamber leaves (217.9 vs 206.6).

**Why it may not deserve its own issue.** No blade entry currently fails on it:
the one that surfaced it is green from the horizon fix alone. Shipping it moves a
term on every leaf, so it owes `bun run bot:refit` and a full `test:blade` under
both weight vectors — worth it only once an entry discriminates on yield at the
production budget (e.g. a Sol Ring vs basic land keep/sacrifice choice inside
one turn).
