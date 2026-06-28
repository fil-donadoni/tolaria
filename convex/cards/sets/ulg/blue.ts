// Urza's Legacy (ULG) — blue cards, split by colour per ADR 0043. The
// registry's `import * as ulg from "./sets/ulg"` resolves through ulg/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";

// Frantic Search — {2}{U} Instant. "Draw two cards, then discard two cards.
// Untap up to three lands." (CR 121.1 draw, CR 701.8 discard, CR 701.20 untap.)
// Stepped resolution: the irreversible draw runs first, then the discard pick,
// then the untap pick — each interactive step is its own `resolveSteps` entry
// so a suspension never re-applies an earlier step (CR 608.2).
export const franticSearch: CardDefinition = {
    id: "1904db14-6df7-424f-afa5-e3dfab31300a",
    name: "Frantic Search",
    rarity: "common",
    oracleText:
        "Draw two cards, then discard two cards. Untap up to three lands.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    resolveSteps: [
        (ctx: SpellContext) => {
            ctx.drawCards(ctx.controller, 2);
        },
        (ctx: SpellContext) => {
            const me = ctx.controller;
            const handCount = ctx.getHandIds(me).length;
            const discard = Math.min(2, handCount);
            if (discard === 0) return;
            const picks = ctx.requestChoice({
                playerId: me,
                choiceId: `frantic-search-discard-${ctx.sourceInstanceId}`,
                kind: "choose-hand-card",
                zone: "hand",
                count: discard,
                prompt: "Discard two cards (Frantic Search).",
            });
            if (picks === undefined) return; // suspended on the discard choice
            for (const id of picks) ctx.discardCard(me, id);
        },
        (ctx: SpellContext) => {
            const me = ctx.controller;
            const lands = ctx.getBattlefieldIds(me, { types: "Land" });
            if (lands.length === 0) return;
            const picks = ctx.requestChoice({
                playerId: me,
                choiceId: `frantic-search-untap-${ctx.sourceInstanceId}`,
                kind: "choose-permanents",
                zone: "battlefield",
                filter: { types: "Land" },
                candidateIds: lands,
                count: { min: 0, max: Math.min(3, lands.length) },
                prompt: "Untap up to three lands (Frantic Search).",
            });
            if (picks === undefined) return; // suspended on the untap choice
            for (const id of picks) ctx.untap({ type: "permanent", id });
        },
    ],
};
