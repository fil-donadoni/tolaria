// Dark Ascension (DKA) — blue cards, split by colour per ADR 0043. The
// registry's `import * as dka from "./sets/dka"` resolves through dka/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";

// Thought Scour — {U} Instant. "Target player mills two cards. Draw a card."
// (CR 701.13a mill — move the top library cards to their owner's graveyard,
// the Millstone pattern via `moveCardById` on the live top ids; CR 121.1 draw.)
export const thoughtScour: CardDefinition = {
    id: "88bf1ebb-9d85-4b9b-a614-c7f965c0893d",
    name: "Thought Scour",
    rarity: "common",
    oracleText: "Target player mills two cards.\nDraw a card.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "player") {
            const topIds = ctx.peekLibraryTop(t.id, 2);
            for (const id of topIds) {
                ctx.moveCardById(t.id, id, "library", "graveyard");
            }
        }
        ctx.drawCards(ctx.controller, 1);
    },
};
