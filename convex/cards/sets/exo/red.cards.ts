// exo — red cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";

// Price of Progress — "Price of Progress deals damage to each player equal to
// twice the number of nonbasic lands that player controls." (CR 120.1 damage
// to each player; CR 122 counting; CR 205.4a supertypes.) Authored DSL-first
// (ADR 0045): a `forEach` over players (APNAP order, CR 608.2) deals each
// player a `count` of the LAND permanents they control that are NOT Basic
// (`excludeSupertype: "Basic"` — the nonbasic selector), scaled `times: 2`
// ("twice the number of …"). Each player's amount is a single damage event, so
// prevention/replacement see one 2N packet, not two N packets.
export const priceOfProgress: CardDefinition = {
    id: "8e5283db-3e22-4862-9d95-56d03d09c2ae",
    rarity: "uncommon",
    name: "Price of Progress",
    oracleText:
        "Price of Progress deals damage to each player equal to twice the number of nonbasic lands that player controls.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "dealDamage",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: { ref: "$each" },
                            filter: { type: "Land", excludeSupertype: "Basic" },
                            times: 2,
                        },
                    },
                    to: { player: { ref: "$each" } },
                },
            ],
        },
    ],
};

// Maniacal Rage — {1}{R} Enchantment — Aura, enchant creature. "Enchanted
// creature gets +2/+2 and can't block." (CR 303.4 Aura via `AURA_AFFECTS_HOST`
// for the pt-buff; CR 509.1b block restriction collected from an Aura and
// applied to its host per CR 303.4 — same collection model as Errantry's
// declared-attack-restriction, `attack-restriction` doc note.)
//
// Home set = earliest paper printing (ADR 0041) = Exodus; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/red.ts`.
export const maniacalRage: CardDefinition = {
    id: "f3aa840f-6a70-4674-acb7-ded0ea4397d8", // EXO 87
    rarity: "common",
    name: "Maniacal Rage",
    oracleText:
        "Enchant creature\nEnchanted creature gets +2/+2 and can't block.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 2, toughness: 2 },
        {
            kind: "block-restriction",
            id: "maniacal-rage-cant-block",
            side: "blocker",
            predicate: () => false,
            oracleText: "Enchanted creature can't block.",
        },
    ],
};
