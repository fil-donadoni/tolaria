// Magic 2011 (M11) — blue cards, split by colour per ADR 0043. The registry's
// `import * as m11 from "./sets/m11"` resolves through m11/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";

// Preordain — {U} Sorcery. "Scry 2, then draw a card." Scry (CR 701.22) is the
// reusable ordered-top primitive `SpellContext.orderTop` with
// `destination: "library-bottom"`: it raises the `order-top` drag choice on the
// top two cards (projected face-up as `libraryPeek`), then on submit puts the
// kept cards back on top in the player's chosen order and the rest on the true
// bottom of the library — honouring "the rest on top in any order", which the
// old `look-top` path could not. Then the draw (CR 121.1). The kept cards stay
// known to the controller afterwards (ADR 0026 — you know your top cards).
export const preordain: CardDefinition = {
    id: "e3868c3d-4fcd-444b-866f-0f8e50ce7b67",
    name: "Preordain",
    rarity: "common",
    oracleText:
        "Scry 2, then draw a card. (To scry 2, look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    resolveSteps: [
        (ctx: SpellContext) => {
            if (
                !ctx.orderTop(ctx.controller, 2, {
                    destination: "library-bottom",
                    prompt: "Scry 2 — keep cards on top (drag to order) or send them to the bottom.",
                })
            ) {
                return; // suspended on the scry choice
            }
        },
        (ctx: SpellContext) => {
            ctx.drawCards(ctx.controller, 1);
        },
    ],
};
