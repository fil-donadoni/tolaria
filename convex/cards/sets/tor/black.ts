// TOR (Torment) — black cards, split by colour per ADR 0043. The registry's
// `import * as tor from "./sets/tor"` resolves through tor/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Cabal Ritual — {1}{B} Instant. "Add {B}{B}{B}. Threshold — Add {B}{B}{B}{B}{B}
// instead if there are seven or more cards in your graveyard." (CR 704.5n
// Threshold ability word — engine infra, no registry row.)
export const cabalRitual: CardDefinition = {
    id: "5403b49d-03a7-4cc3-af3c-df098c1c9c2e",
    rarity: "uncommon",
    name: "Cabal Ritual",
    oracleText:
        "Add {B}{B}{B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "if",
            predicate: {
                left: {
                    count: { zone: "graveyard", controller: "controller" },
                },
                op: "ge",
                right: 7,
            },
            then: [{ op: "addMana", mana: { B: 5 } }],
            else: [{ op: "addMana", mana: { B: 3 } }],
        },
    ],
};

// Sickening Dreams — {1}{B} Sorcery. "As an additional cost to cast this spell,
// discard X cards.\nSickening Dreams deals X damage to each creature and each
// player." (CR 601.2b/118.4 — a variable additional cost; CR 701.9a discard;
// CR 120.3a damage dealt to a player.)
//
// The FIRST card whose X is announced with no `{X}` pip anywhere in its mana
// cost (issue #2714): `additionalCosts.discard.count: "X"` is the caster-chosen
// count generalisation of the fixed discard leg, and the announced X is
// snapshotted onto the stack item exactly as `payXLife` does one resource over,
// so the effect below reads it back through the ordinary `{ X: true }` value.
// X = 0 is a legal announcement (CR 118.3 — a cost of no cards is payable by
// anyone) and makes the spell a 2-mana no-op, which is the printed card.
//
// Damage is split into two `forEach` sweeps, the Plague Spitter shape
// (`inv/black.ts`): the permanents set carries the creature filter, the players
// set carries the player refs, and neither can name the other's members.
//
// compiler-gap: "As an additional cost to cast this spell, discard X cards." (#2693)
export const sickeningDreams: CardDefinition = {
    id: "9396ac77-9f53-46bd-b126-02441a0f5594",
    rarity: "uncommon",
    name: "Sickening Dreams",
    oracleText:
        "As an additional cost to cast this spell, discard X cards.\nSickening Dreams deals X damage to each creature and each player.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    // CR 601.2b — the caster names X at announcement; the cards leave hand at
    // cast commit through the ordinary hand-cost picker. An empty `filter`
    // constrains nothing ("X cards").
    additionalCosts: { discard: { count: "X" } },
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [
                { op: "dealDamage", amount: { X: true }, to: { ref: "$each" } },
            ],
        },
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "dealDamage",
                    amount: { X: true },
                    to: { player: { ref: "$each" } },
                },
            ],
        },
    ],
};
