// Aetherdrift (DFT) — blue cards, split by colour per ADR 0043. The registry's
// `import * as dft from "./sets/dft"` resolves through dft/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";

// Stock Up — {2}{U} Sorcery. "Look at the top five cards of your library. Put
// two of them into your hand and the rest on the bottom of your library in any
// order." (CR 401.4 look; the two kept cards move library→hand via
// `moveCardById`, the Demonic Tutor primitive; the remaining looked-at cards go
// to the bottom via `reorderLibraryTop`, CR 401.) A single `requestChoice`
// (`search-library`) drives the kept-card pick — the resolve re-runs with the
// answer once the player submits.
export const stockUp: CardDefinition = {
    id: "0a786855-6eb4-42c0-a528-4842db46809d",
    name: "Stock Up",
    rarity: "rare",
    oracleText:
        "Look at the top five cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        const me = ctx.controller;
        const topIds = ctx.peekLibraryTop(me, 5);
        if (topIds.length === 0) return;
        const keep = Math.min(2, topIds.length);
        const picks = ctx.requestChoice({
            playerId: me,
            choiceId: `stock-up-${ctx.sourceInstanceId}`,
            kind: "search-library",
            zone: "library",
            candidateIds: topIds,
            count: keep,
            prompt: "Put up to two of these cards into your hand (the rest go to the bottom).",
        });
        if (picks === undefined) return; // suspended on the keep choice
        for (const id of picks) ctx.moveCardById(me, id, "library", "hand");
        // The remaining looked-at cards (still in the library) go to the bottom.
        const pickSet = new Set(picks);
        const restTop = topIds.filter((id) => !pickSet.has(id));
        const all = ctx.peekLibraryTop(me, Number.MAX_SAFE_INTEGER);
        const restSet = new Set(restTop);
        const below = all.filter((id) => !restSet.has(id));
        ctx.reorderLibraryTop(me, [...below, ...restTop]);
    },
};
