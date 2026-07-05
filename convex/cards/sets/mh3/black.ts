// mh3 — black cards (ADR 0043 colour split).

// TODO(tracked-by: tolaria#917) — Emperor of Bones: keyword **Adapt** (CR
// 701.46) is `status: "planned"` in mechanicsRegistry.ts. Also blocked
// independently: "put a creature card exiled WITH this creature onto the
// battlefield" needs linked-exile tracking (which exiled cards are
// associated with which exiler) that doesn't exist, and "whenever one or
// more +1/+1 counters are put on this creature" is a counter-placement
// meta-trigger not currently modeled. Stop-and-issue per
// gre-development.md rather than a `resolve()` workaround.
// export const emperorOfBones: CardDefinition = {
//     id: "df9d9075-2d1e-4848-b661-816d539e05eb",
//     name: "Emperor of Bones",
//     rarity: "rare",
//     manaCost: { X: 1, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Skeleton", "Noble"],
//     power: 2,
//     toughness: 2,
// };

// TODO(issue #679 stub — Crabomination needs Emerge (CR 702.119):
// mechanicsRegistry.ts lists it `status: "planned"` — no keyword name and no
// "cast by sacrificing an artifact, cost reduced by that artifact's mana
// value" alternate-cost primitive exist yet. Emerge is the card's namesake
// mechanic, so — matching the Evoke-gated stub precedent — the whole card
// stays a stub. Stop-and-issue per gre-development.md; tracked stub.
// export const crabomination: CardDefinition = {
//     id: "f328d6e0-d808-4abe-b6a2-cc557b27c329",
//     name: "Crabomination",
//     rarity: "rare",
//     manaCost: { X: 4, B: 2 },
//     types: ["Creature"],
//     subtypes: ["Crab", "Demon"],
//     power: 5,
//     toughness: 5,
// };

export {};
