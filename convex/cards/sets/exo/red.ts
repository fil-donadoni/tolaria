// exo — red cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

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
