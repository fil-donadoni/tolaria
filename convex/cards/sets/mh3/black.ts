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

export {};
