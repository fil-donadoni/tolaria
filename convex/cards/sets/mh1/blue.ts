// mh1 — blue cards (ADR 0043 colour split).
import type { CardDefinition, SpellContext } from "../../types";

// Echo of Eons — {4}{U}{U} Sorcery. "Each player shuffles their hand and
// graveyard into their library, then draws seven cards." with Flashback {2}{U}
// (CR 702.34 — cast from the graveyard for the flashback cost, then exile it).
// This is Timetwister (CR 103.4 whole-table hand/graveyard reset) with a
// flashback back-half, and the marquee flashback play: pitch it, then flash it
// back for a two-mana Timetwister. Echo of Eons is on the stack while it
// resolves, so the graveyard shuffle doesn't sweep it; after resolution the
// flashback rider exiles it (exileOnResolve).
//
// protocol card: a per-player "shuffle hand + graveyard into library, then draw
// seven" has no DSL Op — the frozen grammar has neither a shuffle-library Op nor
// a per-player forEach construct (forEach iterates a target set, not players).
// Identical body to lea/2ed Timetwister's resolve() (composed SpellContext zone
// primitives, no new primitive).
export const echoOfEons: CardDefinition = {
    id: "ff590af2-2d6c-4f16-a9b8-1a6dab6e9ad5",
    rarity: "mythic",
    name: "Echo of Eons",
    oracleText:
        "Each player shuffles their hand and graveyard into their library, then draws seven cards.\nFlashback {2}{U}",
    manaCost: { X: 4, U: 2 },
    types: ["Sorcery"],
    flashback: { X: 2, U: 1 },
    resolve: (ctx: SpellContext) => {
        ctx.forEachPlayer((pid) => {
            ctx.moveZone(pid, "hand", "library");
            ctx.moveZone(pid, "graveyard", "library");
            ctx.shuffleLibrary(pid);
            ctx.drawCards(pid, 7);
        });
    },
};
