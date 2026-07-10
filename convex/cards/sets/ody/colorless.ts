// ody — colorless cards (ADR 0043 colour split).

import type { CardDefinition } from "../../../../convex/cards/types";

// Barbarian Ring — "{T}: Add {R}. Barbarian Ring deals 1 damage to you.
// Threshold — {R}, {T}, Sacrifice Barbarian Ring: It deals 2 damage to any
// target. Activate only if seven or more cards are in your graveyard."
// Premodern Burn staple (PRD #979, issue #992).
export const barbarianRing: CardDefinition = {
    id: "1809361e-ae1a-4c47-8464-e6496e94d962",
    name: "Barbarian Ring",
    rarity: "uncommon",
    oracleText:
        "{T}: Add {R}. Barbarian Ring deals 1 damage to you.\nThreshold — {R}, {T}, Sacrifice Barbarian Ring: It deals 2 damage to any target. Activate only if seven or more cards are in your graveyard.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "barbarian-ring-mana",
            oracleText: "{T}: Add {R}. Barbarian Ring deals 1 damage to you.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => {
                ctx.addMana({ R: 1 });
            },
            manaProduced: { R: 1 },
            dealsDamageToControllerOnTap: 1,
        },
        {
            id: "barbarian-ring-sac",
            oracleText:
                "Threshold — {R}, {T}, Sacrifice Barbarian Ring: It deals 2 damage to any target. Activate only if seven or more cards are in your graveyard.",
            cost: { mana: { R: 1 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            canActivate: (_source, state) => {
                const graveyard = state.players.find(
                    (p) => p.id === _source.controllerId
                )?.graveyard;
                return (graveyard?.length ?? 0) >= 7;
            },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};
