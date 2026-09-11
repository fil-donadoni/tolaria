// ody — multicolor cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Psychatog — {1}{U}{B} Creature — Atog 1/2. "Discard a card: This creature
// gets +1/+1 until end of turn. / Exile two cards from your graveyard: This
// creature gets +1/+1 until end of turn." (CR 701.9a discard as a cost,
// CR 602.2b — an activation cost is paid as the ability is activated.) Both
// abilities are ordinary
// stack-using activated abilities — neither adds mana, so CR 605.1a's mana
// ability exemption does not apply and each waits for priority.
//
// HAND-WRITTEN rather than shipped as a compiled lockfile row (PRD #2693,
// issue #2714) even though the Oracle compiler reads this card perfectly: the
// generated smoke test cannot build a scenario for an Op that pumps
// `$source`, so the compiler quarantines it with "Op \"pump\" targets
// $source/$each — covered by the card's own per-card test". This file plus
// the per-card test below ARE that coverage. Structurally identical to the
// compiler's own output, so it round-trips and carries no `compiler-gap`
// marker (Guard C).
export const psychatog: CardDefinition = {
    id: "6757bf0e-489f-4be2-9e41-463b59f00dd1",
    rarity: "uncommon",
    name: "Psychatog",
    oracleText:
        "Discard a card: This creature gets +1/+1 until end of turn.\nExile two cards from your graveyard: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 1, U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Atog"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "psychatog-ability",
            oracleText:
                "Discard a card: This creature gets +1/+1 until end of turn.",
            // CR 701.9a — the discard is a COST, paid at activation; an empty
            // filter constrains nothing ("a card").
            cost: { discardFilter: { filter: {}, count: 1 } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "psychatog-ability-2",
            oracleText:
                "Exile two cards from your graveyard: This creature gets +1/+1 until end of turn.",
            // "your graveyard" — `owner: "you"` pins the pick to the
            // player who activated the ability (CR 109.5).
            cost: { exileFromGraveyard: { count: 2, owner: "you" } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
