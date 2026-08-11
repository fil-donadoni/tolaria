// AER — colorless cards, split by colour per ADR 0043. The registry's
// `import * as aer from "./sets/aer"` resolves through aer/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Walking Ballista — "This creature enters with X +1/+1 counters on it. {4}:
// Put a +1/+1 counter on this creature. Remove a +1/+1 counter from this
// creature: It deals 1 damage to any target." (CR 122 counters; CR 107.3i
// {X}{X} mana cost, ADR — encoded as `X: "X"` with `xFactor: 2` so the chosen
// X is paid twice.)
export const walkingBallista: CardDefinition = {
    id: "329a8738-3e17-403a-857a-0ba529ce8cd1",
    rarity: "rare",
    name: "Walking Ballista",
    oracleText:
        "This creature enters with X +1/+1 counters on it.\n{4}: Put a +1/+1 counter on this creature.\nRemove a +1/+1 counter from this creature: It deals 1 damage to any target.",
    manaCost: { X: "X", xFactor: 2 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 0,
    toughness: 0,
    entersWith: { counters: [{ type: "+1/+1", count: "X" }] },
    activatedAbilities: [
        {
            id: "walking-ballista-grow",
            oracleText: "{4}: Put a +1/+1 counter on this creature.",
            cost: { mana: { X: 4 } },
            useStack: true,
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        },
        {
            id: "walking-ballista-shoot",
            oracleText:
                "Remove a +1/+1 counter from this creature: It deals 1 damage to any target.",
            cost: { removeCounter: { type: "+1/+1", count: 1 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};
