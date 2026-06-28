// Strixhaven (STX) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as stx from "./sets/stx"` resolves through stx/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";

// Expressive Iteration — {U}{R} Sorcery. "Look at the top three cards of your
// library. Put one of them into your hand, put one of them on the bottom of
// your library, and exile one of them. You may play the exiled card this turn."
// (CR 401.4 look; the kept card moves library→hand via `moveCardById`; the
// exiled card moves library→exile and is granted cast-from-exile this turn via
// `grantCastFromExile` — the Impulse-draw idiom; the bottomed card is placed
// last with `reorderLibraryTop`, CR 401.) Two sequential `requestChoice`
// (`search-library`) picks drive the hand and bottom selections; the resolve
// re-runs on each submit, reading the stored answer once provided. The library
// is mutated only after both picks resolve, so the candidate sets stay stable
// across re-runs.
export const expressiveIteration: CardDefinition = {
    id: "31b770cc-09e7-4c0b-b2a4-462ab4f7200d",
    name: "Expressive Iteration",
    rarity: "uncommon",
    oracleText:
        "Look at the top three cards of your library. Put one of them into your hand, put one of them on the bottom of your library, and exile one of them. You may play the exiled card this turn.",
    manaCost: { U: 1, R: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        const me = ctx.controller;
        const topIds = ctx.peekLibraryTop(me, 3);
        if (topIds.length === 0) return;

        // Pick one of the looked-at cards to put into hand.
        const handPick = ctx.requestChoice({
            playerId: me,
            choiceId: `expressive-iteration-hand-${ctx.sourceInstanceId}`,
            kind: "search-library",
            zone: "library",
            candidateIds: topIds,
            count: 1,
            prompt: "Put one of these cards into your hand.",
        });
        if (handPick === undefined) return; // suspended on the hand choice
        const handId = handPick[0];
        const afterHand = topIds.filter((id) => id !== handId);

        // With two or more remaining, choose which goes to the bottom; the last
        // one is exiled. With a single remaining card, it is exiled directly.
        let bottomId: string | undefined;
        if (afterHand.length >= 2) {
            const bottomPick = ctx.requestChoice({
                playerId: me,
                choiceId: `expressive-iteration-bottom-${ctx.sourceInstanceId}`,
                kind: "search-library",
                zone: "library",
                candidateIds: afterHand,
                count: 1,
                prompt: "Put one of these cards on the bottom of your library.",
            });
            if (bottomPick === undefined) return; // suspended on the bottom choice
            bottomId = bottomPick[0];
        }
        const exileId = afterHand.find((id) => id !== bottomId);

        // Apply the movements once every choice is settled.
        if (handId) ctx.moveCardById(me, handId, "library", "hand");
        if (exileId) {
            ctx.moveCardById(me, exileId, "library", "exile");
            // CR 601.3e / 608.2g — playable from exile for the rest of the turn.
            ctx.grantCastFromExile(exileId, me);
        }
        if (bottomId) {
            // Place the chosen card at the very bottom (CR 401): reorder the
            // whole library so it lands last.
            const all = ctx.peekLibraryTop(me, Number.MAX_SAFE_INTEGER);
            const rest = all.filter((id) => id !== bottomId);
            ctx.reorderLibraryTop(me, [...rest, bottomId]);
        }
    },
};
