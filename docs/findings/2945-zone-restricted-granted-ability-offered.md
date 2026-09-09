---
title: An exile-set-granted ability that functions only in another zone is offered on the battlefield (CR 113.6m)
discoveredBy: 2945
status: draft
confidence: medium
---

**What is wrong.** `resolveActivatedGrant`'s `abilitiesOf` arm
(`convex/gre/layer6.ts`) copies every `activatedAbilities[]` entry of every
qualifying card in the linked exile pile onto the recipient, with no
zone-function gate. CR 113.6m — "An ability whose cost or effect specifies that
it moves the object it's on out of a particular zone functions only in that
zone." So Ashen Ghoul's `{B}: Return this card from your graveyard to the
battlefield` (`convex/cards/sets/ice/black.ts`) is a graveyard-only ability, and
a Cauldron-countered creature on the battlefield is offered it anyway.

Real Magic GRANTS the ability too — the divergence is not the grant, it is that
nothing stops the recipient from ACTIVATING it. The engine takes the `{B}`,
puts an ability on the stack, and `moveZone`'s `$source` graveyard recovery
finds nothing, so it resolves as a no-op (CR 608.2b). A mana-burning affordance
in the UI, and a legal Move `enumerateMoves` will hand the Bot.

**Evidence.**

- `convex/gre/layer6.ts::resolveActivatedGrant` — the copy loop reads
  `def.activatedAbilities` with no zone predicate. (The `types` narrowing added
  by issue #2945 is a CARD-type filter, orthogonal to this.)
- `convex/cards/sets/ice/black.ts` — Ashen Ghoul, `ashen-ghoul-reanimate`, the
  one shipped card that reaches it: link it in the pile and
  `getEffectiveActivatedAbilities(recipient)` offers the row.
- `convex/gre/effects/interpreter.ts` — the `moveZone` `$source` branch's
  graveyard recovery is what silently yields the no-op.

**Why it may not deserve its own issue.** The clean fix is not card-shaped and
not this card's: it is a `functionsOnlyInZone` predicate on `ActivatedAbility`
(or derived from the script's own shape — an Op moving `$source` out of a named
zone), consumed by `getEffectiveActivatedAbilities`, `getStackAbilities` and
`enumerateMoves` alike. That is a whole-mechanic slice under CR 113.6, and it
would also fix the same class outside grants (a graveyard-only ability on a
permanent that was animated, Flashback-adjacent costs). Exactly one shipped card
reaches it through this path today, and its worst outcome is a wasted `{B}` on a
no-op, not an illegal game state — so it is a line on a CR 113.6 slice whenever
one is cut, not a ticket on its own.
