// mh2 — black cards (ADR 0043 colour split).

// TODO(issue #676 stub — "as an additional cost, sacrifice a creature or
// discard a card" is a CASTER-CHOSEN alternative additional cost;
// `CardDefinition.additionalCosts` only models ONE fixed leg at a time
// (sacrificeFilter XOR exileFilter XOR payXLife XOR payLife XOR
// xFromOpponentGraveyard) — there's no "pick cost A or cost B" shape. Stop-
// and-issue per gre-development.md; tracked stub.
// export const boneShards: CardDefinition = {
//     id: "1ee98955-4c47-4d45-9377-608dfa755337",
//     name: "Bone Shards",
//     rarity: "common",
//     manaCost: { B: 1 },
//     types: ["Sorcery"],
// };

// TODO(issue #676 stub — Overload, CR 702.96, is `planned` in
// mechanicsRegistry.ts: no alternative-cost "change target to each"
// primitive exists, and Damn's overload mode (destroy each creature) is half
// the card. Stop-and-issue; tracked stub.
// export const damn: CardDefinition = {
//     id: "efeae088-9ac5-4d2f-a15c-d8675a471ac5",
//     name: "Damn",
//     rarity: "rare",
//     manaCost: { B: 2 },
//     types: ["Sorcery"],
// };

export {};
