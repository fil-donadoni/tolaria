// 5dn (Fifth Dawn) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";

// Crucible of Worlds — {3} Artifact. "You may play lands from your
// graveyard." One bare declarative field, no `resolve()` and no Effect
// Script: `playsLandsFromGraveyard: true` is the CR 305.1-analog player-wide
// land-play permission (issue #1190), read live off the battlefield by
// `canPlayLandsFromGraveyard` (`convex/gre/rules.ts`) — the permission ends
// the instant this artifact leaves play. Unconditional and player-wide,
// distinct from the SCOPED once-per-turn grant to one specific graveyard card
// (Serra Paragon, issue #1149).
export const crucibleOfWorlds: CardDefinition = {
    id: "312a6058-de08-487d-95bd-b3c56807fdd6",
    name: "Crucible of Worlds",
    rarity: "rare",
    oracleText: "You may play lands from your graveyard.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    playsLandsFromGraveyard: true,
};

// Pentad Prism — "Sunburst (This artifact enters with a charge counter on it
// for each color of mana spent to cast it.)\nRemove a charge counter from
// this artifact: Add one mana of any color." STOP-AND-ISSUE (tracked-by:
// #675): Sunburst (CR 702.44) is `status: "planned"` in
// `convex/cards/mechanicsRegistry.ts` — an uncensused mechanic is a
// stop-and-issue case, never an invented name/counter-count hack. Left as a
// tracked stub pending Sunburst.
// export const pentadPrism: CardDefinition = {
//     id: "672b9b16-daef-44e6-9a3a-cfd9f3c78bc7",
//     name: "Pentad Prism",
//     rarity: "common",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
// };
export {};
