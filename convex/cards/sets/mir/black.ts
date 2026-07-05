// mir — black cards (ADR 0043 colour split).

// Shallow Grave — {1}{B} Instant. "Return the top creature card of your
// graveyard to the battlefield. That creature gains haste until end of turn.
// Exile it at the beginning of the next end step." (CR 400.7 reanimation, CR
// 603.7 delayed trigger — the exile-at-next-end-step half is already
// expressible via `delayedTrigger`.) Blocked: "the TOP creature card of your
// graveyard" needs a deterministic (non-player-choice) "top of graveyard"
// object selector; every graveyard-card selection Op today
// (`choice(zone: "graveyard")`) is a player pick, not an implicit positional
// one (issue #920).
// tracked-by: #920
// export const shallowGrave: CardDefinition = {
//     id: "d5c782cc-c951-4c6f-a93f-774ae6c1c214",
//     name: "Shallow Grave",
//     rarity: "rare",
//     manaCost: { X: 1, B: 1 },
//     types: ["Instant"],
// };

export {};
