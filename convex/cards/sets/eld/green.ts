// ELD — green cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld"` resolves through eld/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Once Upon a Time — {1}{G} Instant (issue #790). Modern Oracle text (the
// printed card's original flash-on-your-first-turn clause was later dropped
// from Oracle; this card is a plain Instant today, per Scryfall):
// "If this spell is the first spell you've cast this game, you may cast it
// without paying its mana cost. Look at the top five cards of your library.
// You may reveal a creature or land card from among them and put it into
// your hand. Put the rest on the bottom of your library in a random order."
//
// The free-cast clause is a CR 118.9 alternative cost (`alternativeCosts`) —
// a leg-free variant (no mana/permanent/life/hand leg at all, so
// `chosenAltCost.mana ?? {}` collapses the cast to genuinely free) gated on
// `{ kind: "first-spell-this-game" }`, which reads the caster's OWN lifetime
// `PlayerState.spellsCastThisGame` tally, never reset. The on-resolution
// effect reuses `digToHand` verbatim — the same Op Narset, Parter of Veils
// uses for an identical "look N, may keep 1 matching, rest to random bottom"
// shape — so this card introduces no new Op and needs no hand-written GRE/
// wire test beyond the catalogue-wide static sweep + auto-generated smoke
// test (the per-Op regime, `.claude/rules/gre-development.md`).
export const onceUponATime: CardDefinition = {
    id: "4034e5ba-9974-43e3-bde7-8d9b4586c3a4",
    name: "Once Upon a Time",
    rarity: "rare",
    manaCost: { generic: 1, G: 1 },
    types: ["Instant"],
    oracleText:
        "If this spell is the first spell you've cast this game, you may cast it without paying its mana cost.\nLook at the top five cards of your library. You may reveal a creature or land card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
    alternativeCosts: [
        {
            id: "free-first-spell",
            description: "Cast without paying its mana cost",
            condition: { kind: "first-spell-this-game" },
        },
    ],
    effects: [
        {
            op: "digToHand",
            player: "controller",
            look: 5,
            take: 1,
            optional: true,
            filter: { type: ["Creature", "Land"] },
            reveal: "kept",
            randomBottom: true,
            prompt: "Once Upon a Time — you may put a creature or land card into your hand.",
        },
    ],
};

// TODO(issue #679 stub — Questing Beast needs "combat damage that would be
// dealt by creatures you control can't be prevented": no unpreventable-
// damage / prevention-immunity primitive exists in the replacement-effect
// system (`convex/gre/replacements.ts`, `combatDamagePrevention.ts`) — every
// existing prevention-side primitive models a damage SHIELD, not immunity to
// one. This is a load-bearing clause of the card (it's what makes Questing
// Beast a premier aggressive threat versus Fog effects), not a corner case
// to simplify away. Stop-and-issue per gre-development.md; tracked stub.
// export const questingBeast: CardDefinition = {
//     id: "e41cf82d-3213-47ce-a015-6e51a8b07e4f",
//     name: "Questing Beast",
//     rarity: "mythic",
//     manaCost: { X: 2, G: 2 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Beast"],
//     power: 4,
//     toughness: 4,
// };
