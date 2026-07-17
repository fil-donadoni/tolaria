// CMR — blue cards, split by colour per ADR 0043. The registry's
// `import * as cmr from "./sets/cmr"` resolves through cmr/index.ts.

import type { CardDefinition } from "../../types";
import { TREASURE_TOKEN } from "../../sharedTokens";

// Hullbreacher — {2}{U} Creature — Merfolk Pirate 3/2 (issue #1265, PRD #779,
// ADR 0061). Flash (CR 702.8). One draw-replacement clause on the unified draw
// seam:
//   • "If an opponent would draw a card except the first one they draw in each
//     of their draw steps, instead you create a Treasure token." — a CR 614
//     REDIRECT (ADR 0061 `redirect-to-token` outcome): the opponent's would-be
//     draw is replaced entirely (they draw nothing — no card, no
//     draw-from-empty loss) and THIS card's controller creates a Treasure
//     token instead. `applies` = the drawing player is an OPPONENT of the
//     controller AND it is NOT the turn-based draw-step draw
//     (`!isTurnBasedDrawStepDraw`, "except the first one they draw in each of
//     their draw steps"). Fires at every non-draw-step draw site — extra draws
//     AND effect draws (Divination) — through the single seam. The Treasure's
//     "{T}, Sacrifice this artifact: Add one mana of any color" mana ability
//     ships via the token-scoped `activatedAbilities` passthrough (issue #778,
//     `TREASURE_TOKEN` in `cards/sharedTokens.ts`).
export const hullbreacher: CardDefinition = {
    id: "4df8aabc-7fcb-4b7b-980b-18f499e6c170",
    name: "Hullbreacher",
    rarity: "rare",
    oracleText:
        'Flash\nIf an opponent would draw a card except the first one they draw in each of their draw steps, instead you create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Pirate"],
    power: 3,
    toughness: 2,
    staticAbilities: ["flash"],
    drawReplacement: {
        id: "hullbreacher-draw",
        oracleText:
            "If an opponent would draw a card except the first one they draw in each of their draw steps, instead you create a Treasure token.",
        // "If an OPPONENT would draw ... except the first one they draw in each
        // of their draw steps" — opponent scope AND not the turn-based
        // draw-step draw (CR 614; the draw-step draw is flagged
        // isTurnBasedDrawStepDraw, every other draw is not).
        applies: (event, source) =>
            event.drawingPlayer !== source.controllerId &&
            !event.isTurnBasedDrawStepDraw,
        outcome: { kind: "redirect-to-token", token: TREASURE_TOKEN, count: 1 },
    },
};
