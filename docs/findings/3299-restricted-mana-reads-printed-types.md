---
title: CR 106.6 restricted-mana eligibility reads a spell's PRINTED types, so a Grist spell is not a creature spell
discoveredBy: 3299
status: draft
confidence: medium
---

**What is wrong.** `restrictionAllowsSpell` decides whether restricted mana
("Spend this mana only to cast creature spells", Metamorphosis) may pay for the
spell being cast, and it keys `creature-spell` on the spell's PRINTED type line.
A card with `offBattlefieldCharacteristics` is, under CR 113.6c, whatever its
static ability says while it is on the stack — Grist, the Hunger Tide cast from
hand IS a creature spell there — so creature-restricted mana should be able to
pay for it and today cannot. Exactly the bug issue #3299 fixed one layer over,
in the layer-6 ability-copy grant, and the same one issue #3278 fixed for the
`bind` snapshots.

**Evidence.** `convex/gre/state.ts:22109` `restrictionAllowsSpell` matches on
`spellTypes.includes("Creature")`. Its callers pass a printed-type read rather
than one routed through `gre/zoneCharacteristics.ts`
`resolveZoneCharacteristics(def, "stack")`: `convex/game.ts:3441` → `:3474`,
`:6966` → `:7362`, `:7987` → `:8715`, `:9201`, and `convex/gre/state.ts:20199`,
`:23283`. `SpellContext.getCharacteristics` already routes the `spell` shape to
`"stack"` (the census in `gre/zoneCharacteristics.ts` FAMILY A says so), so this
is a set of call sites the census does not yet claim, not a missing capability.

**Why it may not deserve its own issue.** Exactly one shipped card declares
`offBattlefieldCharacteristics` (Grist, `convex/cards/sets/mh2/multicolor.ts`),
and the interaction needs it cast with restricted creature mana on the same
board. Defensible as a class — the census is meant to be exhaustive and this is
a hole in it — but it may be worth one line on the zone-characteristics rollout
rather than a ticket of its own. A second card with the ability changes that.
