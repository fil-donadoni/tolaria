// bro — colorless cards (ADR 0043 colour split).

// Portal to Phyrexia — {9} Artifact. "When this artifact enters, each
// opponent sacrifices three creatures of their choice. At the beginning of
// your upkeep, put target creature card from a graveyard onto the
// battlefield under your control. It's a Phyrexian in addition to its other
// types." Blocked: the ETB is actually free (2-player-only —
// `choice(kind: "sacrifice-permanents", player: "opponent")` + `sacrifice`,
// the Innocent Blood pattern), but the recurring upkeep reanimation needs a
// CROSS-PLAYER graveyard pick — "a graveyard" (not "your graveyard") means the
// chooser (the controller) and the zone owner (either player) can differ, and
// `choice`'s `player` field conflates the two (works for "your graveyard" —
// Titania, Exhume — not "a graveyard") (issue #920).
// tracked-by: #920
// export const portalToPhyrexia: CardDefinition = {
//     id: "5f608efc-0dbc-4cc3-aadd-ed473bfc29ab",
//     name: "Portal to Phyrexia",
//     rarity: "mythic",
//     manaCost: { X: 9 },
//     types: ["Artifact"],
// };

export {};
