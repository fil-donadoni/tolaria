// M10 (Magic 2010) — white cards, split by colour per ADR 0043. Modern
// Scryfall oracle text is authoritative (ADR 0004). New module (issue #2761):
// Silence's earliest paper printing is M10 (2009-07-17, ADR 0041 home-set
// convention), not the Duskmourn stub it used to sit under.

import type { CardDefinition } from "../../types";

// Silence — {W} Instant. "Your opponents can't cast spells this turn." (CR
// 601.3a spell-cast restriction.) FREED 2026-08-25 (#1841 audit, shipped by
// #2761): the `restrictCasting` Op is `status: "implemented"`
// (`convex/cards/mechanicsRegistry.ts`), shipped by #1057 for Xantid Swarm's
// "defending player can't cast spells this turn" — `player: "opponent"` is
// exactly that shape (Orim's Chant, `pls/white.ts`, targets a chosen player
// instead; Xantid Swarm, `scg/green.ts`, uses the same literal "opponent").
export const silence: CardDefinition = {
    id: "1559d660-8a9d-422b-95d3-710a046583dd", // M10 31 (earliest paper printing, ADR 0041)
    name: "Silence",
    rarity: "rare",
    oracleText: "Your opponents can't cast spells this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    effects: [{ op: "restrictCasting", player: "opponent" }],
};
