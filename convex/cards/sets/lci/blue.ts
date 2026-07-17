// LCI — blue cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #679 stub — Tishana's Tidebinder). The core "counter target
// activated OR triggered ability" engine gap is now CLOSED: Stifle (scg/blue)
// ships the `spellStackKind: "ability"` stack-object kind (keeps any ability,
// activated or triggered) and `ctx.counter` vanishes a countered triggered
// ability (CR 113.7a). What still blocks Tishana specifically is the rest of
// its text — an ETB trigger that ALSO conditionally puts a +1/+1 counter on it
// when the countered ability's source was an artifact/creature/planeswalker —
// which needs a source-type-conditioned follow-up Op, not just the counter.
// Keep tracked stub until that rider is expressible.
// export const tishanasTidebinder: CardDefinition = {
//     id: "907b3d1d-8c85-4707-80b5-c4d832df9846",
//     name: "Tishana's Tidebinder",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Merfolk", "Wizard"],
//     power: 3,
//     toughness: 2,
// };

// tracked-by: #1344 (residue of #1302, parent PRD #620) — Malcolm, Alluring
// Scoundrel. "Flash. Flying. Whenever Malcolm deals combat damage to a
// player, put a chorus counter on it. Draw a card, then discard a card. If
// there are four or more chorus counters on Malcolm, you may cast the
// discarded card without paying its mana cost." The combat-damage trigger
// (counters + draw + choice(discard) + discard) is Op-expressible today, but
// the threshold-gated "cast the discarded card for free" clause has no
// primitive: `grantCastFromExile` is exile-zone only, and `grantGraveyardPlay`
// is a player-wide permission with no per-card targeting and no mana-cost
// waiver. Needs a `grantCastFromGraveyard` Op (or a `zone` discriminator on
// `grantCastFromExile`) — see #1344. Left as a tracked stub pending that Op.
// export const malcolmAlluringScoundrel: CardDefinition = {
//     id: "19d6834d-afa3-4747-a62d-0654f4d9729f",
//     name: "Malcolm, Alluring Scoundrel",
//     rarity: "rare",
//     manaCost: { X: 1, U: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Siren", "Pirate"],
//     power: 2,
//     toughness: 1,
// };

export {};
