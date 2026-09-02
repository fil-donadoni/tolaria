---
title: The spell slot found three more catalogue divergences and two engine fields too narrow to encode a printed cost
discoveredBy: 2699
status: draft
confidence: high
---

**What is wrong.** Issue #2699 shipped the Oracle compiler's instant/sorcery
slot: 422 corpus cards now compile through it, and 31 of the 283 spell-shaped
gold cards round-trip against their hand-written definitions. Pointing a second
reader at that text turned up five things, in two groups. None is fixed here —
this issue's diff is `convex/oracle/**` plus the lockfile, and each of these
changes either a card's behaviour or an engine field's shape.

## Group A — three more hand-written cards disagree with their own Oracle text

Enumerated in `KNOWN_DIVERGENCES` (`convex/oracle/__tests__/gold.test.ts`),
which is what keeps the suite green. Both classes were already named by
`2697-gold-catalogue-divergences.md`; these are further instances, which is
itself the signal — neither is a one-off.

**(1)** **Active Volcano** and **Flash Flood** (`convex/cards/sets/ice/`) — Oracle:
`"Choose one — • Destroy target blue permanent. • Return target Island to
its owner's hand."` Both hand-written definitions encode `"target <colour>
permanent"` as `targetRequirement.type: "any"`.

`"any"` is not a synonym for "permanent". It is CR 115.4's _any target_, and
both consumers implement it that way: `matchesTargetRequirement`
(`src/lib/card-utils.ts`) matches only `DAMAGEABLE_PERMANENT_TYPES`, and
`getLegalTargets` (`convex/gre/rules.ts`) adds players. So as shipped these
two spells can destroy a blue **player** and cannot destroy a blue artifact
or enchantment. The compiler emits the six permanent card types (CR 110.4).

This is the **same defect as Northern Paladin**, already filed in the #2697
finding — the third and fourth instances of one encoding mistake, which
argues the fix is a catalogue sweep for `type: "any"` on a non-damage effect
rather than three per-card edits.

**(2)** **Lava Dart** (`convex/cards/sets/ons/red.ts`) — `flashback: { sacrifice: {
types: "Land", subtypes: "Mountain" } }` for `"Flashback—Sacrifice a
Mountain."`, where the compiler writes `subtypes` alone. The Horror of
Horrors encoding tie from the #2697 finding, at the flashback cost site.
Cosmetic: CR 205.3i already implies the type.

## Group B — two engine fields cannot encode a cost that is printed

Neither is a compiler gap. The grammar reads both phrases correctly and then
has nowhere to put them, so the card fails closed — which is right, and is also
why they are invisible to every existing guard.

**(3)** **A variable additional-cost discard.** `additionalCosts.discard.count` is
typed `number` (`convex/cards/types.ts`), so `"As an additional cost to cast
this spell, discard X cards."` has no encoding at all. **10 corpus cards**
print it, including **Sickening Dreams**, which issue #2699 named as a Tier-1
Premodern target. The neighbouring `payXLife?: boolean` is exactly the shape
this needs — a caster-announced X paid at cast commit and snapshotted onto
the stack item — so the fix looks like a `discardX` sibling rather than a new
mechanism. (Sickening Dreams is blocked twice; see item 5.)

**(4)** **A flashback cost with a life component.** `FlashbackCost`
(`convex/cards/types.ts`) carries `mana`, `sacrifice` and `exileFromHand`.
**Deep Analysis** prints `"Flashback—{1}{U}, Pay 3 life."` and there is no
`life` leg, so its flashback cast cannot be paid. ADR 0079's shared
`CostLegs` already has a `life` leg that `AlternativeCost` and `MayPayCost`
both use; `FlashbackCost` predates the consolidation and did not get it.

## Also noted, not a gap

**(5)** **`"each creature and each player"` / `"each player"`** is refused by
`playerRef` (`convex/oracle/lowerEffects.ts`) with a stated reason: folding
it into a single ref would silently make a symmetrical effect one-sided. It
is the second half of what blocks Sickening Dreams and the whole of what
blocks Innocent Blood. This is a grammar backlog item (a `forEach` over the
player set), not a defect — recorded so the two halves of Sickening Dreams
are not mistaken for one.

**(6)** **Fireball-class cards reach `quarantine`, not `ready`.** The reading is
correct — `{ op: "dealDamage", amount: { X: true } }` — and the quarantine
reason is the smoke generator's: `"amount is chosen-cost X — depends on the
value announced for {X} at cast time"`. That is the pre-existing limitation
already filed as `2697-smoke-generator-blocks-ready.md`, now reached by a
second slot.

**Why this may not deserve its own issue.** Group A is one catalogue sweep, and
belongs with the #2697 finding rather than beside it. Group B is two small,
independent type widenings, each unblocking a named card and a measurable
corpus slice (10 cards and 1 respectively) — those are the ones worth cutting,
and item 3 is the larger of the two by an order of magnitude.
