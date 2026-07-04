// mh3 (Modern Horizons 3) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

// import type { CardDefinition } from "../../types";

// Arena of Glory — "This land enters tapped unless you control a Mountain.
// {T}: Add {R}. {R}, {T}, Exert this land: Add {R}{R}. If that mana is spent
// on a creature spell, it gains haste until end of turn." STOP-AND-ISSUE
// (tracked-by: #675): Exert (CR 701.43) is `status: "planned"` in
// `convex/cards/mechanicsRegistry.ts` — an uncensused mechanic is a
// stop-and-issue case. Left as a tracked stub pending Exert.
// export const arenaOfGlory: CardDefinition = {
//     id: "dd148edc-9e43-41aa-bb50-f912115d3e72",
//     name: "Arena of Glory",
//     rarity: "rare",
//     types: ["Land"],
// };
export {};
