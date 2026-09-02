---
title: the castability census nets a fundable pure-mana-cost ability to zero units, so it withholds a Cast the planner and a human can both make
discoveredBy: 3027
status: draft
confidence: high
---

**What is wrong.** `getProducibleManaUnits` (`convex/gre/rules.ts`) subtracts a
mana ability's own generic sub-cost from the units it contributes:

```ts
const generic = ability?.cost.mana
    ? pureGenericManaSubCost(ability.cost.mana)
    : null;
if (generic !== null && generic > 0) {
    units.splice(Math.max(0, units.length - generic));
}
```

Farrelite Priest's `{1}: Add {W}` is net zero, so it contributes **no units at
all** — including no {W}. The census then reports the board cannot produce
white, and `getLegalActions` withholds the Cast button for a spell the board
genuinely pays for, because the {1} is fundable from a DIFFERENT source.

**Evidence.** Measured on `98ed936f4`, i.e. before issue #3027 changed
anything. Board `[Mox Sapphire, Mox Jet, Farrelite Priest]`, casting Island
Sanctuary (`{1}{W}`):

```
planManaPayment {1}{W} -> [{"cardInstanceId":"sapphire"},
                           {"cardInstanceId":"priest","abilityId":"farrelite-priest-mana"},
                           {"cardInstanceId":"jet"}]
getLegalActions        -> []
```

The plan is correct and a human can make the same play by hand: tap Jet for
{B} to fund the Priest's {1}, the Priest adds {W}, tap Sapphire for the
generic. `planManaPayment` funds exactly this through `fundGenericFromPlain`.
Issue #3027's sweep (`manaConverterParity.bot.test.ts`) counts **94** such
board/spell pairs across its matrix, every one carrying a permanent of this
shape.

This is the `#1695` trap running backwards: the documented direction of the
census's error is over-approximation ("errs toward showing the Cast button",
`canPotentiallyPayCost`), and here it under-approximates and hides a legal
play from the human.

**Why the netting is there.** Issue #2420 review finding 2: counting the
produced colour as a free +1 let the census offer a Cast that
`planManaPayment` could not realise, measured on `[Farrelite Priest, Plains]`
casting Island Sanctuary. The netting fixed a real false positive. It is the
BLUNTNESS that is wrong — netting to zero regardless of whether the sub-cost
is fundable, rather than netting against the leftover the rest of the board
supplies.

**Why it may not deserve its own issue.** Exactly one shipped card has the
shape today (`pureGenericManaSubCost > 0` with no `{T}` and no
`tapOtherFilter`), and it costs a human one manual tap sequence rather than a
lost game. Against that: it is a live, measured, wrong-direction disagreement
between the two mana authorities, in the direction the codebase treats as the
dangerous one, and issue #3027 had to carve a named exemption into the parity
sweep to land — `hasNetZeroManaAbility`, which is the only remaining hole in
that sweep's coverage. If a second card of the shape ships, the exemption
silently widens.
