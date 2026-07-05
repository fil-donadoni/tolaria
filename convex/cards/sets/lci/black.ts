// LCI — black cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — "as an additional cost, discard a card or pay 3
// life" is a CASTER-CHOSEN alternative additional cost; same gap as Bone
// Shards (mh2/black.ts) — `CardDefinition.additionalCosts` only models ONE
// fixed leg (no "pick cost A or cost B" shape, and no plain discard-a-card
// leg at all). Stop-and-issue per gre-development.md; tracked stub.
// export const bitterTriumph: CardDefinition = {
//     id: "05bdd22c-3e11-4c29-bdfa-d3dfc0e90a9f",
//     name: "Bitter Triumph",
//     rarity: "uncommon",
//     manaCost: { X: 1, B: 1 },
//     types: ["Instant"],
// };

// TODO(issue #679 stub — Deep-Cavern Bat's leave trigger needs to remember
// ONE specific card this creature exiled (arbitrarily many turns earlier)
// and move THAT card to its owner's hand when Deep-Cavern Bat leaves.
// `SpellContext` has no exile-zone reader (`getHandCards`/`getBattlefieldIds`
// exist; no `getExileIds`) and no generic per-instance scratch note that
// stores a card id (only `addCounter`, numeric). The one channel that DOES
// carry a value from an ETB exile to a later trigger,
// `exileWithAttachments`/`returnExiledForSource` (ADR 0028), is wired only
// for a return-to-BATTLEFIELD host (Tawnos's Coffin shape) — not a
// return-to-hand. `scheduleDelayedTrigger`'s `timing: "leaves-battlefield"`
// (issue #731/#916) looked promising but is explicitly THIS-TURN-scoped —
// "every `leaves-battlefield` instance is this-turn scoped... purged at
// CLEANUP" (convex/gre/phases.ts) — wrong semantics for an "until this
// leaves the battlefield" duration that must survive across turns. Stop-
// and-issue per gre-development.md; tracked stub.
// export const deepCavernBat: CardDefinition = {
//     id: "69c68c95-b788-43b1-9f22-1b22c5a00b25",
//     name: "Deep-Cavern Bat",
//     rarity: "uncommon",
//     manaCost: { X: 1, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Bat"],
//     power: 1,
//     toughness: 1,
// };

export {};
