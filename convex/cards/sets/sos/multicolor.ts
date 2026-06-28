// SOS (Scourge) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as sos from "./sets/sos"` resolves through sos/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition, SpellContext } from "../../types";

// Traumatic Critique — {X}{U}{R} Instant. "Traumatic Critique deals X damage to
// any target. Draw two cards, then discard a card." CR 107.3 X cost (read via
// getX()), CR 115.4 "any target", CR 121.1 draw, CR 701.8 discard. Stepped
// resolution: the irreversible damage + draw run first, then the discard pick
// can suspend without re-running them (CR 608.2).
export const traumaticCritique: CardDefinition = {
    id: "2a812fa7-4599-4e25-97db-20ffc6bc0b26",
    rarity: "common",
    name: "Traumatic Critique",
    oracleText:
        "Traumatic Critique deals X damage to any target. Draw two cards, then discard a card.",
    manaCost: { X: "X", U: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolveSteps: [
        (ctx: SpellContext) => {
            const t = ctx.targets[0];
            if (t) ctx.dealDamage(t, ctx.getX());
            ctx.drawCards(ctx.controller, 2);
        },
        (ctx: SpellContext) => {
            const picks = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: `traumatic-critique-discard-${ctx.sourceInstanceId}`,
                kind: "choose-hand-card",
                zone: "hand",
                count: 1,
                prompt: "Discard a card (Traumatic Critique).",
            });
            if (picks === undefined) return; // suspended on the discard choice
            for (const id of picks) ctx.discardCard(ctx.controller, id);
        },
    ],
};
