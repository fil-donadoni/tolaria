---
title: getBasicLandMana returns only the FIRST basic subtype's colour, so a dual land's mana ability must be hand-written while a basic's must not
discoveredBy: 2694
status: draft
confidence: high
---

**What is wrong.** The catalogue encodes the CR 305.6 intrinsic mana ability two
incompatible ways, and both are load-bearing:

- `Forest` (`convex/cards/sets/lea/colorless.ts:1573`) carries NO
  `activatedAbilities` at all. Its mana comes from the intrinsic path.
- `Badlands` carries an explicit `{ id: "badlands-mana", cost: { tap: true },
useStack: false, manaChoices: [{ B: 1 }, { R: 1 }] }`.

The reason is `getBasicLandMana` (`convex/gre/constants.ts:282-288`): it iterates
the land's subtypes and **returns on the first one that maps**, so a land with
two basic land types (`Land — Swamp Mountain`) taps only for the first colour.
The ten original dual lands therefore need a hand-written ability to be playable
at all, while a basic needs none — and a basic that HAD one would presumably
double up.

CR 305.6 draws no such distinction: "An object with the land card type and a
basic land type has the intrinsic ability '{T}: Add [mana symbol]'", one per
basic land type. Kudzu-style effects and Magical Hack can also give a land a
second basic type at run time, which the intrinsic path would still read as one
colour.

**Evidence.** `convex/gre/constants.ts:282-288` (`getBasicLandMana`, early
`return color`); `convex/gre/manaColors.ts:17` (`LAND_SUBTYPE_MANA`);
`convex/cards/sets/lea/colorless.ts:1573` (Forest, no abilities) against the
Badlands/Bayou/Plateau/Savannah/Scrubland/Taiga/Tundra/Underground Sea/Volcanic
Island definitions, which all carry an explicit `manaChoices` ability.

Surfaced because the Oracle compiler must decide what to emit for a land whose
Oracle text is pure reminder text, and the catalogue gives two answers. #2694
resolves it by refusing the card (`compile.ts` returns `unparsed` for any land
with a basic land type), which is fail-closed but costs every basic land and
every dual land its `ready` row.

**Why it may not deserve its own issue.** Nothing is observably broken today:
the duals' hand-written abilities cover the gap, and no shipped card changes a
land's basic type in a way that would expose the early return. It is a
correctness debt whose only current cost is that the compiler cannot express
either shape — so it might reasonably be folded into #2697 (which has to settle
intrinsic abilities anyway) rather than tracked separately. The counter-argument
is that a general `getBasicLandMana` returning ALL matching colours is a small,
self-contained fix that would let the compiler emit nothing for every basic land
type and delete ten redundant hand-written abilities.
