// EOE — blue cards, split by colour per ADR 0043. The registry's
// `import * as eoe from "./sets/eoe"` resolves through eoe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Consult the Star Charts — "Kicker {1}{U}. Look at the top X cards of your
// library, where X is the number of lands you control. Put one of those cards
// into your hand. If this spell was kicked, put two of those cards into your
// hand instead. Put the rest on the bottom of your library in a random order."
// (CR 702.33 Kicker, CR 401.4 dig.) `digToHand` looks at `look` = the number of
// lands you control (`count` value) and puts `take` (1, or 2 when kicked) into
// hand, bottoming the rest — one execution path, no new Op. Vintage Cube Kicker
// cluster (issue #692, ADR 0041).
export const consultTheStarCharts: CardDefinition = {
    id: "a16a6555-2e3a-4587-aacd-0307d696b26c",
    rarity: "rare",
    name: "Consult the Star Charts",
    oracleText:
        "Kicker {1}{U} (You may pay an additional {1}{U} as you cast this spell.)\nLook at the top X cards of your library, where X is the number of lands you control. Put one of those cards into your hand. If this spell was kicked, put two of those cards into your hand instead. Put the rest on the bottom of your library in a random order.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    kicker: { cost: { X: 1, U: 1 } },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "digToHand",
                    player: "controller",
                    look: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: "Land" },
                        },
                    },
                    take: 2,
                },
            ],
            else: [
                {
                    op: "digToHand",
                    player: "controller",
                    look: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: "Land" },
                        },
                    },
                    take: 1,
                },
            ],
        },
    ],
};
