// CN2 — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as cn2 from "./sets/cn2"` resolves through cn2/index.ts.

import type { CardDefinition } from "../../types";

// Leovold, Emissary of Trest — {B}{G}{U} Legendary Creature — Elf Advisor 3/3
// (issue #1265, PRD #779, ADR 0061). Two clauses:
//   • "Each opponent can't draw more than one card each turn." — a CR 614
//     draw-replacement on the unified seam with the `prevent` outcome
//     (ADR 0061): an opponent's SECOND-and-later draw each turn
//     (`drawIndexThisTurn >= 1`, read from `drawnThisTurn`) is prevented — no
//     card, no draw-from-empty loss. The first draw (including their turn-based
//     draw-step draw) is unaffected. `applies` = opponent scope AND
//     drawIndexThisTurn >= 1.
//   • "Whenever you or a permanent you control becomes the target of a spell or
//     ability an opponent controls, you may draw a card." — a BECAME_TARGET
//     triggered ability (CR 603.2b, issue #1265). `matches` = the targeted
//     object's controller is Leovold's controller ("you or a permanent you
//     control") AND the targeting source is an OPPONENT
//     (`sourceControllerId !== self.controllerId`). `oncePerEventBatch` folds a
//     single spell/ability that targets several of your objects down to ONE
//     trigger (the Leovold Gatherer ruling). The optional "may draw" is a
//     cost-free `mayPay` gate over the DSL `draw` Op (the Verduran Enchantress
//     shape) — the controller's own draw is not caught by the prevent clause
//     (that applies only to opponents).
export const leovoldEmissaryOfTrest: CardDefinition = {
    id: "49bb0ad3-1082-41f1-82a4-52a4006cc9b6",
    name: "Leovold, Emissary of Trest",
    rarity: "mythic",
    oracleText:
        "Each opponent can't draw more than one card each turn.\nWhenever you or a permanent you control becomes the target of a spell or ability an opponent controls, you may draw a card.",
    manaCost: { B: 1, G: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elf", "Advisor"],
    power: 3,
    toughness: 3,
    drawReplacement: {
        id: "leovold-draw",
        oracleText: "Each opponent can't draw more than one card each turn.",
        // "Each OPPONENT can't draw more than one card each turn" — an
        // opponent's 2nd+ draw (0-based index >= 1) is prevented; their first
        // draw of the turn (incl. their draw-step draw) is unaffected.
        applies: (event, source) =>
            event.drawingPlayer !== source.controllerId &&
            event.drawIndexThisTurn >= 1,
        outcome: { kind: "prevent" },
    },
    triggeredAbilities: [
        {
            id: "leovold-target-draw",
            oracleText:
                "Whenever you or a permanent you control becomes the target of a spell or ability an opponent controls, you may draw a card.",
            event: "BECAME_TARGET",
            // CR 603.2b — "you or a permanent you control" is
            // targetControllerId === controller; "an opponent controls" is the
            // source being controlled by someone else.
            matches: (event, self) =>
                event.type === "BECAME_TARGET" &&
                event.targetControllerId === self.controllerId &&
                event.sourceControllerId !== self.controllerId,
            // CR 603.2b ruling — one spell/ability targeting several of your
            // objects triggers Leovold only ONCE (BECAME_TARGET emits per
            // target; collapse the same-batch matches to a single trigger).
            oncePerEventBatch: true,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Draw a card?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        },
    ],
};
