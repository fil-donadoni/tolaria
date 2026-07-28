// NPH — colorless cards, split by colour per ADR 0043. The registry's
// `import * as nph from "./sets/nph"` resolves through nph/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { AURA_AFFECTS_HOST } from "../../types";
import type { CardDefinition } from "../../types";
import { equipAbility, livingWeapon } from "../../abilities/equipment";

// Batterskull (issue #1340, parent PRD #620) — the Living Weapon tracer.
// Every clause is declarative on top of the Equipment spine (#776/ADR 0065):
//
//  - Living weapon (CR 702.92a) is the shared `livingWeapon()` self-ETB
//    trigger: `createToken` (the 0/0 black Phyrexian Germ, `sharedTokens.ts`)
//    with a `bind`, then the generic `attach` Op reading that binding back.
//    The Germ's art resolves per-printing from the token-print lockfile.
//  - +4/+4 and the two keyword grants are flat layer-7c / layer-6 statics
//    gated by the canonical `AURA_AFFECTS_HOST` predicate (Equipment and
//    Auras share one grant path, ADR 0065).
//  - "{3}: Return this Equipment to its owner's hand." is a plain
//    instant-speed activated ability whose body is a `moveZone` on the bare
//    `$source` snapshot — the self-bounce shape (Blinking Spirit). Returning
//    the Equipment detaches it (CR 704.5q is moot: it has left the
//    battlefield), which leaves the Germ an unbuffed 0/0 that dies to the
//    zero-toughness SBA (CR 704.5f) — the printed "reset" play pattern, all
//    pre-existing engine behavior.
export const batterskull: CardDefinition = {
    id: "cd114ec3-d286-4c70-a122-3043bc53cc88",
    name: "Batterskull",
    rarity: "mythic",
    oracleText:
        "Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)\nEquipped creature gets +4/+4 and has vigilance and lifelink.\n{3}: Return this Equipment to its owner's hand.\nEquip {5}",
    manaCost: { generic: 5 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 4,
            toughness: 4,
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "vigilance",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "lifelink",
        },
    ],
    triggeredAbilities: [livingWeapon({ id: "batterskull-living-weapon" })],
    activatedAbilities: [
        {
            id: "batterskull-return",
            oracleText: "{3}: Return this Equipment to its owner's hand.",
            cost: { mana: { generic: 3 } },
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
        equipAbility({
            id: "batterskull-equip",
            cost: { generic: 5 },
            oracleText: "Equip {5}",
        }),
    ],
};
