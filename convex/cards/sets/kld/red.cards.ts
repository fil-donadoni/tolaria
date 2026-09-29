// kld — red cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";
import { CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID } from "../../emblems";

// Chandra, Torch of Defiance — {2}{R}{R} Legendary Planeswalker — Chandra,
// loyalty 4 (KLD, CR 306). Un-stubbed with the cast-during-resolution Op
// extended for exile-top + paid inline cast (CR 608.2f, issues #1477 / #1478,
// closes #1252). All four loyalty abilities use the shipped loyalty framework
// (ADR 0058, #700):
//   +1 (impulse): "Exile the top card of your library. You may cast that card.
//       If you don't, Chandra deals 2 damage to each opponent." — the
//       `castDuringResolution` Op sources the top card via `fromTopOfLibrary`
//       (exile-then-offer, paying the card's NORMAL mana cost, CR 601.2g), and
//       binds the cast/decline/can't-pay outcome to `$cast`; the reflexive 2
//       damage is a plain `if not $cast` branch (NOT bespoke card code).
//   +1 (mana): "Add {R}{R}." → addMana Op (#850).
//   −3: "Chandra deals 4 damage to target creature." → dealDamage Op.
//   −7: emblem "Whenever you cast a spell, this emblem deals 5 damage to any
//       target." → emblem Op + the triggered EmblemDefinition (#1221 / #1478).
export const chandraTorchOfDefiance: CardDefinition = {
    id: "ff8086cd-b868-4f4e-823e-2635ad7ebc07",
    name: "Chandra, Torch of Defiance",
    rarity: "mythic",
    oracleText:
        '+1: Exile the top card of your library. You may cast that card. If you don\'t, Chandra deals 2 damage to each opponent.\n+1: Add {R}{R}.\n−3: Chandra deals 4 damage to target creature.\n−7: You get an emblem with "Whenever you cast a spell, this emblem deals 5 damage to any target."',
    manaCost: { X: 2, R: 2 },
    types: ["Planeswalker"],
    supertypes: ["Legendary"],
    subtypes: ["Chandra"],
    loyalty: 4,
    activatedAbilities: [
        {
            id: "chandra-torch-of-defiance-plus1-impulse",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Exile the top card of your library. You may cast that card. If you don't, Chandra deals 2 damage to each opponent.",
            // CR 608.2f — the exiled card is cast AS PART OF resolving this
            // ability (timing / card-type restrictions ignored), paying its
            // real mana cost; declining / being unable to pay leaves it exiled
            // and fires the reflexive 2 damage (`if not $cast`).
            effects: [
                {
                    op: "castDuringResolution",
                    player: "controller",
                    fromTopOfLibrary: true,
                    resultBind: "$cast",
                },
                {
                    op: "if",
                    predicate: { not: { binding: "$cast" } },
                    // CR 118 — 2-player engine: "each opponent" is the sole
                    // opponent.
                    then: [
                        {
                            op: "dealDamage",
                            amount: 2,
                            to: { player: "opponent" },
                        },
                    ],
                },
            ],
        },
        {
            id: "chandra-torch-of-defiance-plus1-mana",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText: "+1: Add {R}{R}.",
            effects: [{ op: "addMana", mana: { R: 2 }, player: "controller" }],
        },
        {
            id: "chandra-torch-of-defiance-minus3",
            cost: { loyalty: -3 },
            useStack: true,
            oracleText: "−3: Chandra deals 4 damage to target creature.",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
        },
        {
            id: "chandra-torch-of-defiance-minus7",
            cost: { loyalty: -7 },
            useStack: true,
            oracleText:
                '−7: You get an emblem with "Whenever you cast a spell, this emblem deals 5 damage to any target."',
            effects: [
                {
                    op: "emblem",
                    emblem: CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID,
                },
            ],
        },
    ],
};
