# Migrating every `canActivate` closure to declarative data

Tolaria does not plan a wholesale migration of printed activation restrictions
("Activate only if…", "Activate only during…") from `ActivatedAbility.canActivate`
closures to declarative data. The declarative gate grows one card class at a
time, when the existing predicate grammar already expresses the restriction.
A restriction that would need new vocabulary stays a closure until a second
card shows what that vocabulary has to vary on.

What IS in scope (issue #3685): a generic declarative activation condition on
`ActivatedAbility`, built on the existing `EffectPredicate` / `EffectCount`
grammar, adopted by the abilities that grammar already fits (threshold — seven
or more cards in your graveyard) and by every new card it fits from then on.

## Why the rest is out of scope

The migration was proposed for four reasons. After triage, three of them are
already covered or have become small:

- **Bot reachability** is fixed without migrating. The Bot's ability
  enumerator calls the same pure closure the server's legality gate calls
  (issue #3441), so an ability gated by a closure is a move the Bot can make.
- **The client hint** already runs the closure against the board the viewer
  can see (`hasManaAbility` / `isActivationTimingAllowed` and siblings in
  `src/lib/card-utils.ts`). The UI does not need data to grey out a button.
- **The Oracle compiler** (PRD #2693) reports a closure-bearing card as
  `incomparable` (`convex/oracle/gold.ts`), not as a match and not as a defect.
  The hole is a number somebody can watch, not a hidden gap.

The fourth reason, the client affordability sweep auto-skipping `canActivate`
abilities, is real, but it does not justify 18 new predicates.

The cost side, from the census at triage (2026-09-15, 21 non-mana abilities
plus 3 mana abilities):

- **12 source-state predicates**: tapped, counters on it, attached, attacked
  or blocked this turn, per-turn activation tally (Clockwork Beast, Ice
  Cauldron, Soul Kiss, Grizzled Wolverine, Tourach's Gate, …). Each would need
  a new predicate shape, most of them used by exactly one card.
- **4 snow-land board counts**, **1 hand size** (Library of Alexandria),
  **1 turn ownership** (Nettling Imp), and **1 graveyard position** (Ashen
  Ghoul: "three or more creature cards are above this card"). The count grammar
  has no position qualifier.
- **3 mana abilities** (Chrome Mox, Mox Opal, Fanatic of Rhonas) whose
  `canActivate` is read by around nine consumers across client and server.

Inventing that vocabulary card by card breaks the naming rule (issue #1917):
the generic name comes from card #1, but the generic shape waits for card #2
to show the axis of variation. A predicate designed for a single printed card
is a card-shaped primitive with a generic name.

```ts
// Stays a closure: no second card yet tells us what "source state" varies on.
canActivate: (source) => source.isTapped === true,

// Becomes data: the grammar already says it.
// { left: { count: { zone: "graveyard", controller: "controller" } }, op: "ge", right: 7 }
```

## When to revisit

Migrate a class when a **new** card needs the same restriction as a shipped
closure. At that point the second card supplies the shape, and both move to
data in the same change. That is a normal card slice, not a reopening of this
record.

## Prior requests

- issue #3685: "Should printed activation restrictions be declarative data
  instead of `canActivate` closures?" (split from issue #3441). Resolved as
  threshold-only; the wholesale migration is recorded here.
