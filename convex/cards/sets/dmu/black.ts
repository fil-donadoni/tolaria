// DMU — black cards, split by colour per ADR 0043. The registry's
// `import * as dmu from "./sets/dmu"` resolves through dmu/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, SpellContext } from "../../types";
import { drawTrigger } from "../../abilities/triggers/drawTrigger";

// Sheoldred, the Apocalypse — {2}{B}{B} Legendary Creature — Phyrexian
// Praetor 4/5. "Deathtouch. Whenever you draw a card, you gain 2 life.
// Whenever an opponent draws a card, they lose 2 life." (CR 702.2 deathtouch
// as a static keyword string; CR 121.1 draw-triggered life swing via
// `drawTrigger`, ADR 0045 for the `scope: "your"` half. The `scope:
// "opponents"` half stays imperative: `drawTrigger`'s `effects` reads
// `ctx.controller`, which is Sheoldred's controller, not the drawing
// player — an opponent's draw needs to hit THAT player's life total, so this
// clause calls `ctx.loseLife(drawingPlayerId, 2)` directly (mirrors the
// documented `phaseTrigger`/`drawTrigger` `effects` scope restriction, not an
// unmodelled Op). Part of the #674 card-draw/card-advantage FREE tranche.)
export const sheoldredTheApocalypse: CardDefinition = {
    id: "d67be074-cdd4-41d9-ac89-0a0456c4e4b2",
    name: "Sheoldred, the Apocalypse",
    rarity: "mythic",
    oracleText:
        "Deathtouch\nWhenever you draw a card, you gain 2 life.\nWhenever an opponent draws a card, they lose 2 life.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Phyrexian", "Praetor"],
    power: 4,
    toughness: 5,
    staticAbilities: ["deathtouch"],
    triggeredAbilities: [
        drawTrigger({
            id: "sheoldred-your-draw-gain-life",
            oracleText: "Whenever you draw a card, you gain 2 life.",
            scope: "your",
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        }),
        drawTrigger({
            id: "sheoldred-opponent-draw-lose-life",
            oracleText: "Whenever an opponent draws a card, they lose 2 life.",
            scope: "opponents",
            resolve: (ctx: SpellContext, _event, drawingPlayerId: string) => {
                ctx.loseLife(drawingPlayerId, 2);
            },
        }),
    ],
};
