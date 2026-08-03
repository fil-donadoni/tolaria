// war — black cards (ADR 0043 colour split).

// Bolas's Citadel — {3}{B}{B}{B} Legendary Artifact (Vintage Cube
// edict/discard/hand disruption, issue #682). "You may look at the top card
// of your library any time. You may play lands and cast spells from the top
// of your library. If you cast a spell this way, pay life equal to its mana
// value rather than pay its mana cost. {T}, Sacrifice ten nonland
// permanents: Each opponent loses 10 life." Blocked: the card's DEFINING
// ability stacks three gaps — (a) persistent top-of-library visibility
// (adjacent to the `planned` `scryReorder` backlog Op #682 itself flags),
// (b) a "play/cast from library" permission generalizing the existing
// `grantCastFromExile` (`convex/cards/types.ts`) to a new zone, and (c) a
// cost-replacement mechanism ("pay life equal to mana value INSTEAD OF the
// mana cost") that exists for no card yet. The {T}, Sacrifice ten: drain 10
// clause is free in isolation, but shipping only that would misrepresent the
// card (never ship partial). #931 (the card-list residue this was split
// from) is CLOSED; with a fan-out of ONE card these three gaps are
// catalogued, not scheduled, in the cube classification tracker #1525 —
// they get a dedicated issue when this card is actually wanted.
// tracked-by: #1525
// export const bolassCitadel: CardDefinition = {
//     id: "d2124603-d20e-40eb-97f0-a66323397ac2",
//     name: "Bolas's Citadel",
//     rarity: "mythic",
//     manaCost: { X: 3, B: 3 },
//     types: ["Artifact"],
//     supertypes: ["Legendary"],
// };

export {};
