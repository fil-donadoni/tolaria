// exo — black cards (ADR 0043 colour split).

// Recurring Nightmare — {2}{B} Enchantment. "Sacrifice a creature, Return
// this enchantment to its owner's hand: Return target creature card from
// your graveyard to the battlefield. Activate only as a sorcery." Blocked:
// the activation cost "Return this enchantment to its owner's hand" has no
// `ActivatedAbility.cost` field — the cost shapes cover
// tap/mana/sacrifice/sacrificeFilter/tapOtherFilter/life/removeCounter/discard
// variants, but not "bounce the source itself as a cost" (issue #920).
// tracked-by: #920
// export const recurringNightmare: CardDefinition = {
//     id: "c8173030-1c33-417c-b8e9-79231b6a85a7",
//     name: "Recurring Nightmare",
//     rarity: "rare",
//     manaCost: { X: 2, B: 1 },
//     types: ["Enchantment"],
// };

export {};
