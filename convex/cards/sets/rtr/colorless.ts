// RTR — colorless cards, split by colour per ADR 0043. The registry's
// `import * as rtr from "./sets/rtr"` resolves through rtr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Deathrite Shaman's cost is a single HYBRID pip
// {B/G}; `ManaCost` (cards/types.ts) has no hybrid representation at all
// (no `hybrid`/alternate-pip field, only fixed per-colour counts) — there is
// no faithful way to declare "castable for either B or G" today. The three
// graveyard-exile abilities themselves (moveZone to exile + gainLife/
// loseLife, one mana-ability effect closure) would be DSL-clean once the
// cost can be declared. Stop-and-issue per gre-development.md; tracked stub.
// export const deathriteShaman: CardDefinition = {
//     id: "70496f16-c4c0-4c03-beef-454eb4824cd1",
//     name: "Deathrite Shaman",
//     rarity: "rare",
//     types: ["Creature"],
//     subtypes: ["Elf", "Shaman"],
//     power: 1,
//     toughness: 2,
// };

export {};
