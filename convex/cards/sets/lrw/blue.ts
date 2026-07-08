// Lorwyn (LRW) — blue cards, split by colour per ADR 0043. The registry's
// `import * as lrw from "./sets/lrw"` resolves through lrw/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";

// Ponder — {U} Sorcery. "Look at the top three cards of your library, then put
// them back in any order. You may shuffle. Draw a card." The look-and-reorder is
// the reusable `SpellContext.orderTop` with `destination: "none"` (every card
// stays on top, only the order changes — CR 401.4 look, CR 401 reorder): it
// raises the `order-top` drag choice on the top 3 and puts them back in the
// player's chosen order, marking them known to the caster (ADR 0026). Then an
// optional shuffle (CR 701.20 — which clears that knowledge), then the draw
// (CR 121.1). Each interactive step is its own `resolveSteps` entry so a
// suspension never re-applies an earlier step.
export const ponder: CardDefinition = {
    id: "ba6b6fc5-5077-4812-b8e9-906783dbaf67",
    name: "Ponder",
    rarity: "common",
    oracleText:
        "Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    resolveSteps: [
        (ctx: SpellContext) => {
            if (
                !ctx.orderTop(ctx.controller, 3, {
                    destination: "none",
                    prompt: "Put these cards back on top in any order (rightmost = top).",
                })
            ) {
                return; // suspended on the reorder
            }
        },
        (ctx: SpellContext) => {
            // "You may shuffle" — a no-cost may decision by the caster.
            const shuffle = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: `ponder-shuffle-${ctx.sourceInstanceId}`,
                prompt: "Shuffle your library (Ponder)?",
            });
            if (shuffle === undefined) return; // suspended on the may
            if (shuffle) ctx.shuffleLibrary(ctx.controller);
        },
        (ctx: SpellContext) => {
            ctx.drawCards(ctx.controller, 1);
        },
    ],
};
