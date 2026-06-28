// Lorwyn (LRW) — blue cards, split by colour per ADR 0043. The registry's
// `import * as lrw from "./sets/lrw"` resolves through lrw/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";

// Ponder — {U} Sorcery. "Look at the top three cards of your library, then put
// them back in any order. You may shuffle. Draw a card." Composed exactly like
// Portent (ice/blue.ts) but on the caster's OWN library: peek top 3 + a
// `reorder-library` choice (CR 401.4 look, CR 401 reorder), then an optional
// shuffle (CR 701.20), then the draw (CR 121.1). Each interactive step is its
// own `resolveSteps` entry so a suspension never re-applies an earlier step.
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
            const me = ctx.controller;
            const topIds = ctx.peekLibraryTop(me, 3);
            if (topIds.length === 0) return;
            const ordered = ctx.requestChoice({
                playerId: me,
                choiceId: `ponder-reorder-${ctx.sourceInstanceId}`,
                kind: "reorder-library",
                zone: "library",
                count: topIds.length,
                candidateIds: topIds,
                prompt: "Put these cards back on top in any order (first = top).",
            });
            if (ordered === undefined) return; // suspended on the reorder
            const allIds = ctx.peekLibraryTop(me, Number.MAX_SAFE_INTEGER);
            const orderedSet = new Set(ordered);
            const rest = allIds.filter((id) => !orderedSet.has(id));
            ctx.reorderLibraryTop(me, [...ordered, ...rest]);
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
