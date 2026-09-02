---
title: the castability census counts a {T} mana ability's full yield free when its extra cost leg is coloured, offering a Cast nothing can pay
discoveredBy: 3027
status: draft
confidence: high
---

**What is wrong.** `getProducibleManaUnits` (`convex/gre/rules.ts`) nets an
activated mana ability's own sub-cost out of its produced units, but only for a
**pure-generic** one:

```ts
const generic = ability?.cost.mana
    ? pureGenericManaSubCost(ability.cost.mana)
    : null;
if (generic !== null && generic > 0)
    units.splice(Math.max(0, units.length - generic));
```

`pureGenericManaSubCost` returns `null` for a cost with a coloured component,
so the netting never fires and the ability's whole yield is counted **free**.

**Evidence.** Apprentice Wizard, "{U}, {T}: Add {C}{C}{C}", alone on the
battlefield, casting Ankh of Mishra (`{2}`):

```
getLegalActions -> ["cast"]
planManaPayment({2}) -> null
```

There is no second source, so the `{U}` cannot be paid and the Wizard produces
nothing at all. The census offers the Cast anyway — the #1695 trap: the player
takes it and strands in `pendingCast` with a cost they cannot cover.

Pre-existing and independent of issue #3027: `rules.ts` is untouched by that
change, and the planner answered `null` on `98ed936f4` too (one source, one
mana, two pips needed). It only became visible when issue #3027 asserted the
two authorities against each other.

**Scale.** Adding Apprentice Wizard to the sweep pool in
`manaConverterParity.bot.test.ts` produces **11** board/spell pairs of this
shape. It is the only shipped card whose `{T}` mana ability carries a coloured
`cost.mana`; Implements of Sacrifice's leg is generic (`{1}`) and IS netted.

**Why it may not deserve its own issue.** One card, and the failure is a
recoverable UI dead-end rather than an illegal game state — CR 601.2f payment
still refuses, so nothing wrong can commit. Against that: it is exactly the
false-positive Cast the #1695 work exists to prevent, the fix is the same
one-line shape as the netting already there (net any `cost.mana` the board
cannot independently fund, not merely a pure-generic one), and it is the reason
issue #3027 could not simply add the card to its parity sweep. Note the sibling
draft `3027-census-nets-fundable-mana-ability-to-zero.md` pushes the same
netting in the OPPOSITE direction — they are one piece of work, not two.
