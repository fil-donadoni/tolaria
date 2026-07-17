// NEO — white cards, split by colour per ADR 0043. The registry's
// `import * as neo from "./sets/neo"` resolves through neo/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import {
    AURA_AFFECTS_HOST,
    RECONFIGURE_LOSES_CREATURE_WHILE_ATTACHED,
} from "../../types";

// Lion Sash — "{W}: Exile target card from a graveyard. If it was a
// permanent card, put a +1/+1 counter on this permanent. Equipped creature
// gets +1/+1 for each +1/+1 counter on this Equipment. Reconfigure {2}"
// (CR 702.151, issue #1311 — unblocks #917's Vintage Cube tranche). Ships
// the Reconfigure keyword end-to-end via ADR 0065's unified attachment
// model: the two Reconfigure activated abilities are the generic `attach` /
// `unattach` Effect Script Ops (CR 701.3), and "isn't a creature while
// attached" (CR 702.151b) is the `type-remove` static effect gated by the
// shared `RECONFIGURE_LOSES_CREATURE_WHILE_ATTACHED` predicate.
//
// "Equipped creature gets +1/+1 for each +1/+1 counter on this Equipment" is
// a characteristic-defining P/T ability (CR 604.3, `pt-cda`) reading counters
// on the SOURCE (Lion Sash) and applying to its HOST via the canonical
// `AURA_AFFECTS_HOST` predicate — the same attach plumbing an Aura's P/T buff
// uses, generalized: `AURA_AFFECTS_HOST` only reads `source.attachedTo`, it
// doesn't care whether the source is an Aura or an Equipment.
export const lionSash: CardDefinition = {
    id: "3e1766e9-2fa7-4446-a255-7beea1467ece",
    name: "Lion Sash",
    rarity: "rare",
    oracleText:
        "{W}: Exile target card from a graveyard. If it was a permanent card, put a +1/+1 counter on this permanent.\nEquipped creature gets +1/+1 for each +1/+1 counter on this Equipment.\nReconfigure {2} ({2}: Attach to target creature you control; or unattach from a creature. Reconfigure only as a sorcery. While attached, this isn't a creature.)",
    manaCost: { generic: 1, W: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Equipment", "Cat"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (source) => {
                const n = source.counters?.["+1/+1"] ?? 0;
                return { power: n, toughness: n };
            },
        },
        {
            kind: "type-remove",
            applies: RECONFIGURE_LOSES_CREATURE_WHILE_ATTACHED,
            types: ["Creature"],
        },
    ],
    activatedAbilities: [
        {
            id: "lion-sash-graveyard-hate",
            oracleText:
                "{W}: Exile target card from a graveyard. If it was a permanent card, put a +1/+1 counter on this permanent.",
            cost: { mana: { W: 1 } },
            targetRequirement: { type: "card", count: 1, zone: "graveyard" },
            useStack: true,
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "exile",
                    bind: "$exiled",
                },
                {
                    op: "if",
                    predicate: {
                        left: { ref: "$exiled.isPermanentCard" },
                        op: "eq",
                        right: 1,
                    },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        },
        {
            // CR 702.151a, first half — "[Cost]: Attach this permanent to
            // another target creature you control. Activate only as a
            // sorcery." `excludeInstanceIds` (via the dynamic
            // `getTargetRequirement`) drops the CURRENT host from the legal
            // target set — CR 702.151a's "ANOTHER target creature".
            id: "lion-sash-reconfigure-attach",
            oracleText:
                "Reconfigure {2} ({2}: Attach to target creature you control; or unattach from a creature. Reconfigure only as a sorcery. While attached, this isn't a creature.)",
            cost: { mana: { generic: 2 } },
            sorcerySpeedOnly: true,
            getTargetRequirement: (source) => ({
                type: "Creature",
                count: 1,
                controller: "you",
                excludeInstanceIds: source.attachedTo
                    ? [source.attachedTo]
                    : [],
            }),
            useStack: true,
            effects: [{ op: "attach", target: { target: 0 } }],
        },
        {
            // CR 702.151a, second half — "[Cost]: Unattach this permanent.
            // Activate only if this permanent is attached to a creature and
            // only as a sorcery." `canActivate` enforces the "only if
            // attached" clause; no target (there is nothing to unattach TO).
            id: "lion-sash-reconfigure-unattach",
            oracleText:
                "{2}: Unattach this permanent. Activate only as a sorcery.",
            cost: { mana: { generic: 2 } },
            sorcerySpeedOnly: true,
            canActivate: (source) => source.attachedTo !== undefined,
            useStack: true,
            effects: [{ op: "unattach" }],
        },
    ],
};
