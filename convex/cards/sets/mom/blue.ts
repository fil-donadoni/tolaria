// mom — blue cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";
import {
    drawTrigger,
    nthDrawThisTurn,
} from "../../abilities/triggers/drawTrigger";

// Faerie Mastermind — {1}{U} Creature — Faerie Rogue, 2/1. "Flash. Flying.
// Whenever an opponent draws their second card each turn, you draw a card.
// {3}{U}: Each player draws a card." (issue #781, PRD #620 Vintage Cube
// worklist.) Flash/flying are both `status: "implemented"` Mechanics Registry
// rows. The first triggered ability needed a per-card ordinal on CARD_DRAWN
// the engine didn't have — `CardDrawnEvent.drawIndexThisTurn` (`cards/types.ts`)
// + `nthDrawThisTurn` (`cards/abilities/triggers/drawTrigger.ts`), the
// draw-side twin of the per-player spell-cast counter Ledger Shredder shipped
// under issue #1343. `scope: "opponents"` gates on the DRAWING player being an
// opponent of this creature's controller; the effect itself ("you draw a
// card") always targets `ctx.controller` — the source's own controller,
// resolved identically for every trigger scope (CR 603.3d, `buildSpellContext`
// binds `controller: item.castById` from the STACK ITEM's controller, never
// the firing event's player) — so it is exactly as DSL-expressible under
// `scope: "opponents"` as it would be under `scope: "your"`, unlike a
// draw-trigger whose effect must act on the DRAWING player (Sheoldred).
// "Each player draws a card" is the `forEach { set: "players" }` shape
// Timetwister already exercises (`sets/lea/blue.ts`).
export const faerieMastermind: CardDefinition = {
    id: "52d3005f-a1c7-4ef5-911f-ccc0752f4181", // MOM printing (scryfallId)
    name: "Faerie Mastermind",
    rarity: "rare",
    oracleText:
        "Flash\nFlying\nWhenever an opponent draws their second card each turn, you draw a card.\n{3}{U}: Each player draws a card.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Faerie", "Rogue"],
    power: 2,
    toughness: 1,
    staticAbilities: ["flash", "flying"],
    triggeredAbilities: [
        drawTrigger({
            id: "faerie-mastermind-opponent-second-draw",
            oracleText:
                "Whenever an opponent draws their second card each turn, you draw a card.",
            scope: "opponents",
            condition: nthDrawThisTurn(2),
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    activatedAbilities: [
        {
            id: "faerie-mastermind-each-draws",
            oracleText: "{3}{U}: Each player draws a card.",
            cost: { mana: { X: 3, U: 1 } },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        { op: "draw", player: { ref: "$each" }, count: 1 },
                    ],
                },
            ],
        },
    ],
};
