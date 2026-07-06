// m20 — colorless cards (ADR 0043 colour split).
import type { CardDefinition, PermanentView } from "../../types";

// Manifold Key — {1} Artifact (issue #684, Cube FREE evasion/protection
// statics). "{1}, {T}: Untap another target artifact.\n{3}, {T}: Target
// creature can't be blocked this turn." (CR 701.20 untap; CR 702.9-class
// "can't be blocked" via the engine's `unblockable` keyword grant, CR
// 613.1f temporary keyword grant.)
export const manifoldKey: CardDefinition = {
    id: "715e637a-dfd8-45a0-b1ea-53e4abd29307",
    name: "Manifold Key",
    rarity: "uncommon",
    oracleText:
        "{1}, {T}: Untap another target artifact.\n{3}, {T}: Target creature can't be blocked this turn.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "manifold-key-untap",
            oracleText: "{1}, {T}: Untap another target artifact.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            getTargetRequirement: (source: PermanentView) => ({
                type: "Artifact",
                count: 1,
                excludeInstanceIds: [source.id],
            }),
            effects: [
                {
                    op: "tapUntap",
                    action: "untap",
                    target: { target: 0 },
                },
            ],
        },
        {
            id: "manifold-key-unblockable",
            oracleText: "{3}, {T}: Target creature can't be blocked this turn.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "grantAbility",
                    ability: "unblockable",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
