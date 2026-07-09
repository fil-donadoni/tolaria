// MMQ — blue cards, split by colour per ADR 0043. The registry's
// `import * as mmq from "./sets/mmq"` resolves through mmq/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, CardPrint } from "../../types";

// Counterspell — MMQ reprint of the LEA instant ("Counter target spell").
// CardPrint onto the LEA definition (ADR 0014).
export const counterspellMmq: CardPrint = {
    printId: "7bd03c80-7812-4704-9e07-9cf73b49c01f",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e",
    setCode: "mmq",
    rarity: "common",
};

// Gush — "You may return two Islands you control to their owner's hand rather
// than pay this spell's mana cost. Draw two cards." (CR 118.9 alternative cost;
// CR 120.1 / draw.) The alternative cost is a censusless rules concept (no
// keyword name); the resolution effect is a single already-censused `draw` Op.
export const gush: CardDefinition = {
    id: "e755bbef-bf34-49c0-ae72-d70e3599de52", // MMQ 82
    rarity: "common",
    name: "Gush",
    oracleText:
        "You may return two Islands you control to their owner's hand rather than pay this spell's mana cost.\nDraw two cards.",
    manaCost: { X: 4, U: 1 },
    types: ["Instant"],
    alternativeCosts: [
        {
            id: "return-two-islands",
            description: "Return two Islands you control to their owner's hand",
            action: "return",
            count: 2,
            filter: { subtypes: "Island" },
        },
    ],
    effects: [{ op: "draw", player: "controller", count: 2 }],
};

// Thwart — "You may return three Islands you control to their owner's hand
// rather than pay this spell's mana cost. Counter target spell." (CR 118.9
// alternative cost; CR 701.5a counter.) The resolution effect is a single
// already-censused `counter` Op.
export const thwart: CardDefinition = {
    id: "c12a0717-e9ea-4be3-a29f-179671ed4489", // MMQ 108
    rarity: "uncommon",
    name: "Thwart",
    oracleText:
        "You may return three Islands you control to their owner's hand rather than pay this spell's mana cost.\nCounter target spell.",
    manaCost: { X: 2, U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    alternativeCosts: [
        {
            id: "return-three-islands",
            description:
                "Return three Islands you control to their owner's hand",
            action: "return",
            count: 3,
            filter: { subtypes: "Island" },
        },
    ],
    effects: [{ op: "counter", target: { target: 0 } }],
};
