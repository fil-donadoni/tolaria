// plc — red cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Prodigal Pyromancer — "{T}: Prodigal Pyromancer deals 1 damage to any
// target." DSL-only ACTIVATED ability (ADR 0045, issue #803): the ability's
// effect is a declarative Effect Script — a single `dealDamage` Op on the
// announced target (CR 120.1) — executed by the interpreter through the SAME
// code path as spell-site scripts, with the ability's controller and source
// permanent bound from the resolution context. The tap cost, useStack flag and
// target requirement stay on the ability; only the effect payload is data. The
// modern "Tim" reprint (cf. Prodigal Sorcerer).
//
// Home set = earliest paper printing (ADR 0041) = Planar Chaos (PLC 105); it was first
// implemented against the M11 reprint, which filed it under the wrong home
// set and rendered the wrong art. That printing now rides along as a
// `CardPrint` in `m11/red.ts`.
export const prodigalPyromancer: CardDefinition = {
    id: "97787109-408e-42d3-acc5-300f5f5bf2ff", // PLC 105
    rarity: "uncommon",
    name: "Prodigal Pyromancer",
    oracleText: "{T}: This creature deals 1 damage to any target.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "prodigal-pyromancer-zap",
            oracleText:
                "{T}: Prodigal Pyromancer deals 1 damage to any target.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};
