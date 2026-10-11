# Echo and Cumulative upkeep are typed cost fields expanded at `getDefinition`

## Status

accepted — grilled 2026-10-11 (issue #5504, slice of PRD issue #5187).
Extends ADR 0054 (implicit keyword expansion) to cost-parameter keywords;
reuses the ADR 0079 `CostLegs` vocabulary.

## Context

The Oracle compiler refuses every Echo and Cumulative upkeep line
(issue #5187: `Echo {...}` 5/7 and `Cumulative upkeep {...}` 0/1 on
premodern-metagame, 32/48 and 14/57 corpus-wide). A Grammar Rule alone cannot
close them: no JSON `CardDefinition` field expresses either keyword.

What the engine has today:

1. Both keywords are hand-called factories, `echoTrigger` and
   `cumulativeUpkeepTrigger`, returning a `TriggeredAbility` whose behaviour
   lives in `phaseTrigger` closures (`interveningIf`, `resolve`,
   `resolveSteps`). About 33 call sites across the ice, ulg, usg and vis
   sets, each with a card-specific ability id.
2. Both already take a STRUCTURED cost, `MayPayCost` (a bare `ManaCost` or the
   ADR 0079 `CostLegs` union: mana, life, permanent, hand, energy). Cumulative
   upkeep scales every leg by the age-counter count.
3. Echo additionally needs the bare `"echo"` string in `staticAbilities`: it is
   the flag that arms `echoPending` — and only on the spell-resolution ETB path.
4. Cost-parameter keywords already compiled (`madness`, `morph`, `flashback`,
   `buyback`) are typed `CardDefinition` fields. Only Fading/Vanishing use a
   `staticAbilities` string, because their parameter is a number, not a cost.
5. Three Ice Age cards (Balduvian Shaman, Breath of Dreams, Dreams of the Dead)
   GRANT cumulative upkeep to another permanent through
   `grantTriggeredAbilityPermanent`, using the factory as the template.

## Decision

**1. Typed fields, not strings.** `CardDefinition` gains
`echo?: MayPayCost` and `cumulativeUpkeep?: MayPayCost`. The expander at the
`getDefinition` seam (the ADR 0054 mechanism) synthesizes the upkeep trigger
from the field by calling the factory. The prompt's cost label is derived from
the cost, never declared. A Grammar Rule emits `{ kind: "echo", cost }` /
`{ kind: "cumulativeUpkeep", cost }` the way `cyclingRule` emits cycling. A
string form was rejected: it would need a second cost grammar inside a string.

**2. One authority: every printed Echo / Cumulative upkeep migrates.** No
hand-written card keeps calling the factory for its own keyword; ability ids
become generic (`"echo"`, `"cumulative-upkeep"`). The factory survives only as
the expander's body and as the template the grant sites share. Coexistence was
rejected: two shapes of one keyword never round-trip (Guard C) and double the
places a fix must reach.

**3. The bare `"echo"` string is retired.** `echoPending` is armed by the
presence of the `echo` field. The Mechanics Registry row keeps the name.

**4. `echoPending` follows CR 702.30a whole.** "Came under your control since
the beginning of your last upkeep" arms the flag on EVERY entry to the
battlefield (not only spell resolution) and on EVERY control change.
`markEchoPaid` stays engine state behind the keyword — no new Op; the card's
JSON carries only the cost.

**5. Cumulative upkeep coverage = every `CostLegs` shape.** Per-counter cost
CHOICES ("{W} or {U}", CR 702.24a) have no `MayPayCost` shape; the Grammar
Rule refuses that form with its reason and the claim moves to a new issue.

## Consequences

- Issue #5505 implements this: field + expander + migration + the full-route
  `echoPending` arming + both Grammar Rules.
- Two tests that name card-specific ability ids are updated to the generic ids.
- A granted cumulative upkeep is still a factory call at the grant site — the
  only remaining direct caller, by construction.
