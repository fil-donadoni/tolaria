// Magic 2011 (M11) — blue cards, split by colour per ADR 0043. The registry's
// `import * as m11 from "./sets/m11"` resolves through m11/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";

// Preordain — {U} Sorcery. "Scry 2, then draw a card." Scry has no dedicated
// primitive (CR 701.42): it is composed from `peekLibraryTop` + a `look-top`
// choice (#942 — pick any subset of the looked-at top two to put on the
// bottom; the projection exposes exactly those two face-up as `libraryPeek`,
// the fix for `partition` exposing nothing on the wire) + a
// `reorderLibraryTop` that lays the kept cards back on top and the chosen ones
// on the bottom, then the draw (CR 121.1). The kept cards retain their relative
// order on top (the engine offers no further reorder for a 2-card scry — a
// faithful-enough simplification of "the rest on top in any order").
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
            const me = ctx.controller;
            const topIds = ctx.peekLibraryTop(me, 2);
            if (topIds.length === 0) return;
            const toBottom = ctx.requestChoice({
                playerId: me,
                choiceId: `preordain-scry-${ctx.sourceInstanceId}`,
                kind: "look-top",
                zone: "library",
                candidateIds: topIds,
                count: { min: 0, max: topIds.length },
                prompt: "Scry 2 — choose any number of cards to put on the bottom (the rest stay on top).",
            });
            if (toBottom === undefined) return; // suspended on the scry choice
            const bottomSet = new Set(toBottom);
            const keptTop = topIds.filter((id) => !bottomSet.has(id));
            const all = ctx.peekLibraryTop(me, Number.MAX_SAFE_INTEGER);
            const topSet = new Set(topIds);
            const middle = all.filter((id) => !topSet.has(id));
            // Kept cards on top, untouched library below, scryed cards on bottom.
            ctx.reorderLibraryTop(me, [...keptTop, ...middle, ...toBottom]);
        },
        (ctx: SpellContext) => {
            ctx.drawCards(ctx.controller, 1);
        },
    ],
};
