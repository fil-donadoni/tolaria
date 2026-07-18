// clb — blue cards (ADR 0043 colour split).

// TODO(issue #1308 residue): Displacer Kitten — "Avoidance — Whenever you
// cast a noncreature spell, exile up to one target nonland permanent you
// control, then return that card to the battlefield under its owner's
// control." ("Avoidance" is a flavor ability WORD, not a keyword — no
// `staticAbilities` entry needed.) The clause is the SAME-EFFECT
// exile-then-return (flicker/blink) idiom `moveZone` cannot express: its
// `target` shape infers the current zone from the object's snapshot kind
// (a permanent → `to: "hand"` only; a graveyard-card → `to: "battlefield"`),
// with no `"exile-card"` branch to feed a preceding `exile` Op's bind back in
// — mirroring the pre-existing Ephemerate stub (mh1/white.ts) exactly, the
// same gap. Stop-and-issue per gre-development.md; tracked-by: #1375
// export const displacerKitten: CardDefinition = {
//     id: "c7a401b8-29fb-46ef-a663-427f66724d5c",
//     name: "Displacer Kitten",
//     rarity: "rare",
//     manaCost: { X: 3, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Cat", "Beast"],
//     power: 2,
//     toughness: 2,
// };

export {};
