// OTJ — colorless cards, split by colour per ADR 0043. The registry's
// `import * as otj from "./sets/otj"` resolves through otj/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import { wardAbility } from "../../abilities/ward";

// Lavaspur Boots — {1} Artifact — Equipment (Vintage Cube FREE wave 3, issue
// #1530, parent PRD #1525). "Equipped creature gets +1/+0 and has haste and
// ward {1}. Equip {1}."
//
// +1/+0 (`pt-buff`) and haste (`keyword-grant`) are the SAME
// `AURA_AFFECTS_HOST`-scoped continuous-static shape Cori-Steel Cutter
// (`tdm/red.ts`, +1/+1/trample/haste) and Skullclamp (`dst/colorless.ts`,
// +1/-1, the Equip {1} spine this card's own Equip ability reuses) already
// prove.
//
// Ward is the genuinely new composition: CR 702.21a Ward is a TRIGGERED
// ability (`wardAbility()`, `cards/abilities/ward.ts`, issue #1312 — fully
// unit-tested there as a PRINTED keyword, `abilities/__tests__/ward.test.ts`),
// not a plain keyword flag like haste, so a `keyword-grant` alone (which only
// pushes a reminder STRING into `staticAbilities`) cannot make it function —
// exactly the same reminder-vs-enforcement split shroud has (see Lightning
// Greaves, `mrd/colorless.ts`). The enforcement half needs the granted
// permanent to gain the actual `TriggeredAbility` object, which is what
// `StaticTriggeredGrant` (`kind: "triggered-grant"`, `cards/types.ts`) is
// for — Energy Flux (`atq/blue.ts`) and The Tabernacle at Pendrell Vale
// (`leg/colorless.ts`) already prove the mechanism (a battlefield-wide grant
// via `triggeredGrantTemplates[]`, scanned as if printed on the recipient —
// `self` in the granted trigger IS the recipient, per `triggers.ts`'s
// `buildTriggerItem(state, permanent, ability.id, event)`, so `wardAbility`'s
// `self.id === event.target.id` match and its `spellTargetsSelfSource` pin
// (which resolves off `item.triggerSourceId`, set to the RECIPIENT's own id)
// both resolve correctly against the EQUIPPED CREATURE, not the Equipment).
// This card is simply the first to scope that same `applies` predicate to
// `AURA_AFFECTS_HOST` (an attach relationship) instead of a group filter —
// no new engine primitive, a new combination of two already-proven ones.
//
// The reminder string "ward {1}" is ALSO pushed via a `keyword-grant` (paired
// with the `triggered-grant`, mirroring Sterling Grove's shroud pattern) so
// the equipped creature's effective `staticAbilities` carries the
// board-visible keyword the Mechanics Registry's `ward` row documents,
// exactly as a printed ward creature would.
export const lavaspurBoots: CardDefinition = {
    id: "e50709de-e6ef-4dbc-af1e-290fed279f34",
    name: "Lavaspur Boots",
    rarity: "uncommon",
    oracleText:
        "Equipped creature gets +1/+0 and has haste and ward {1}. (Whenever it becomes the target of a spell or ability an opponent controls, counter it unless that player pays {1}.)\nEquip {1}",
    manaCost: { generic: 1 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 1,
            toughness: 0,
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "haste",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "ward {1}",
        },
        {
            kind: "triggered-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "lavaspur-boots-ward",
        },
    ],
    // Kept off `triggeredAbilities` so Lavaspur Boots itself (never a
    // creature, never targetable the way its host is) doesn't fire its own
    // copy of the granted trigger — same convention as Energy Flux.
    triggeredGrantTemplates: [
        wardAbility({
            id: "lavaspur-boots-ward",
            cost: { generic: 1 },
            costLabel: "{1}",
        }),
    ],
    activatedAbilities: [
        {
            // CR 702.6e — Equip is sorcery-speed-only and targets a creature
            // its controller controls.
            id: "lavaspur-boots-equip",
            oracleText: "Equip {1}",
            cost: { mana: { generic: 1 } },
            sorcerySpeedOnly: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            useStack: true,
            effects: [{ op: "attach", target: { target: 0 } }],
        },
    ],
};
