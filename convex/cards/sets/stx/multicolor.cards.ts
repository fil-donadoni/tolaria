// Strixhaven (STX) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as stx from "./sets/stx/index.cards"` re-exports this module.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import { defineCard, type SpellContext } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

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
export const expressiveIteration = defineCard(() => ({
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
            // CR 601.3 / 608.2g — playable from exile until end of turn: the
            // "this-turn" window is revoked at CLEANUP (CR 514.2). A land is
            // played as a land (CR 305.2), a spell is cast. CR 305.9 (issue
            // #1689) — oracle says "you may PLAY the exiled card", land-inclusive.
            ctx.grantCastFromExile(exileId, me, undefined, "this-turn", {
                includesLand: true,
            });
        }
        if (bottomId) {
            // Place the chosen card at the very bottom (CR 401): reorder the
            // whole library so it lands last.
            const all = ctx.peekLibraryTop(me, Number.MAX_SAFE_INTEGER);
            const rest = all.filter((id) => id !== bottomId);
            ctx.reorderLibraryTop(me, [...rest, bottomId]);
        }
    },
}));

// Witherbloom Apprentice — {B}{G} Creature — Human Druid, 2/2. Magecraft is one
// triggered ability on both `SPELL_CAST` and `SPELL_COPIED` (CR 707.10, CR
// 603.2). Two-player engine, so `"opponent"` IS "each opponent".
// hand-tail: Magecraft — Whenever you cast or copy an instant or sorcery spell, each opponent loses 1 life and you gain 1 life. (#2087)
export const witherbloomApprentice = defineCard(() => ({
    id: "7f80a11b-188b-464c-b00d-c9d1cfb8ddee",
    name: "Witherbloom Apprentice",
    rarity: "common",
    oracleText:
        "Magecraft — Whenever you cast or copy an instant or sorcery spell, each opponent loses 1 life and you gain 1 life.",
    manaCost: { B: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Druid"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        spellCastTrigger({
            id: "witherbloom-apprentice-magecraft",
            oracleText:
                "Magecraft — Whenever you cast or copy an instant or sorcery spell, each opponent loses 1 life and you gain 1 life.",
            scope: "you",
            alsoOnCopy: true,
            filter: { types: ["Instant", "Sorcery"] },
            effects: [
                { op: "loseLife", player: "opponent", amount: 1 },
                { op: "gainLife", player: "controller", amount: 1 },
            ],
        }),
    ],
}));
