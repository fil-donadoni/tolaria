// nph — black cards (ADR 0043 colour split). New Phyrexia (2011) is the home
// set (earliest paper printing) for this Phyrexian-mana cube cluster (issue
// #696). Dismember is black even though it can be cast for life: its Phyrexian
// pips `{B/P}` are black mana symbols (CR 105.2 — `getColorsFromCost` counts
// them).
import type { CardDefinition } from "../../types";

// Dismember — "Target creature gets -5/-5 until end of turn." Phyrexian mana
// `{1}{B/P}{B/P}` (CR 107.4f): each `{B/P}` is paid with {B} or 2 life, the
// caster's per-pip choice, resolved in the cost system (`convex/gre/phyrexian.
// ts`, threaded through `announceCast.phyrexianLifePips`). The on-resolution
// effect is a plain -5/-5 until end of turn via the `pump` Op (CR 611.1 layer
// 7c temporary P/T modification) — DSL-first, no closure needed.
export const dismember: CardDefinition = {
    id: "064dfdeb-485f-473e-9fa0-8fdb7638cdc6",
    rarity: "uncommon",
    name: "Dismember",
    oracleText:
        "({B/P} can be paid with either {B} or 2 life.)\nTarget creature gets -5/-5 until end of turn.",
    manaCost: { X: 1, phyrexian: { B: 2 } },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "pump",
            target: { target: 0 },
            power: -5,
            toughness: -5,
            duration: { phase: "end-of-turn" },
        },
    ],
};
