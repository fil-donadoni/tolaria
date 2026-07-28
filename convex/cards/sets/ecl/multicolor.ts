// ECL — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { PROTECTION_FROM_EACH_OPPONENT } from "../../../gre/protection";

// Vibrance — {3}{R/G}{R/G} Creature. "When this creature enters, if {R}{R}
// was spent to cast it, this creature deals 3 damage to any target. When
// this creature enters, if {G}{G} was spent to cast it, search your library
// for a land card, reveal it, put it into your hand, then shuffle. You gain
// 2 life. Evoke {R/G}{R/G}." Issue #900 SHIPPED both halves this card
// originally needed: Evoke itself (`CardDefinition.evoke` + `evokeTrigger`,
// see Solitude/Grief in mh2/white.ts / mh2/black.ts) and spent-mana-color
// tracking (`CardInstanceState.notedManaSpentOnCast`, populated at ETB from
// `CardDefinition.noteManaSpent`, readable by a `condition` predicate — the
// exact shape "if {R}{R} was spent" needs). What remains blocking THIS card
// specifically WAS a DIFFERENT, more basic gap that #900 never covered: its
// printed cost {3}{R/G}{R/G} AND its evoke cost {R/G}{R/G} both need a HYBRID
// mana pip. That gap has since CLOSED — guild-hybrid pips are declarable
// (`ManaCost.hybrid`) and payable with mana (PRD #1736 / issue #1738), as
// Figure of Fable below now demonstrates — so this card is unblocked and
// simply not yet written; it ships with the rest of the hybrid card wave.
// Home file is `multicolor.ts` (a genuine R/G card), NOT `colorless.ts` — the
// worklist auto-classifier's `parseManaCost` drops hybrid `{R/G}` symbols
// entirely and misfiled it (the importer gap is its own ticket).
// tracked-by: #1745, #1742
// export const vibrance: CardDefinition = {
//     id: "b9f71c3b-0840-475f-9c17-fdacbc7f3213",
//     name: "Vibrance",
//     rarity: "mythic",
//     manaCost: { X: 3 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 4,
//     toughness: 4,
// };

// Figure of Fable — {G/W} Creature — Kithkin, 1/1 (Vintage Cube, issue #684,
// shipped by #1749). "{G/W}: This creature becomes a Kithkin Scout with base
// power and toughness 2/3. {1}{G/W}{G/W}: If this creature is a Scout, it
// becomes a Kithkin Soldier with base power and toughness 4/5.
// {3}{G/W}{G/W}{G/W}: If this creature is a Soldier, it becomes a Kithkin
// Avatar with base power and toughness 7/8 and protection from each of your
// opponents."
//
// The EVE-era Figure of Destiny (eve/multicolor.ts) is the reference shape;
// see its comment for the staged-respec design. This card differs in one
// instructive way: its type line genuinely REPLACES rather than accumulating
// (Scout → Soldier → Avatar, each dropping the previous), which is why the
// `setSubtype` (replace) Op is right for both and `addSubtype` is right for
// neither — under an additive Op this creature would stay a Scout forever and
// its second ability would remain re-activatable.
//
// The stub this replaces claimed the card needed a Level-Up-style engine
// primitive. It did not: it needed the INDEFINITE form of three Ops that
// already existed (issue #1746, CR 611.2b), the live-object `objectMatchesFilter`
// predicate (#1747), guild-hybrid pips payable with mana (#1738/#1739) and
// player-quality protection (#1748) — no card-shaped primitive at all.
export const figureOfFable: CardDefinition = {
    id: "e0ef33dd-5f6d-48fa-8ef6-a8092868d50f",
    name: "Figure of Fable",
    rarity: "rare",
    oracleText:
        "{G/W}: This creature becomes a Kithkin Scout with base power and toughness 2/3.\n{1}{G/W}{G/W}: If this creature is a Scout, it becomes a Kithkin Soldier with base power and toughness 4/5.\n{3}{G/W}{G/W}{G/W}: If this creature is a Soldier, it becomes a Kithkin Avatar with base power and toughness 7/8 and protection from each of your opponents.",
    manaCost: { hybrid: [["G", "W"]] },
    types: ["Creature"],
    subtypes: ["Kithkin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "figure-of-fable-scout",
            oracleText:
                "{G/W}: This creature becomes a Kithkin Scout with base power and toughness 2/3.",
            cost: { mana: { hybrid: [["G", "W"]] } },
            useStack: true,
            effects: [
                {
                    op: "setSubtype",
                    target: { ref: "$source" },
                    subtypes: ["Kithkin", "Scout"],
                },
                {
                    op: "setBasePT",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 3,
                },
            ],
        },
        {
            id: "figure-of-fable-soldier",
            oracleText:
                "{1}{G/W}{G/W}: If this creature is a Scout, it becomes a Kithkin Soldier with base power and toughness 4/5.",
            cost: {
                mana: {
                    generic: 1,
                    hybrid: [
                        ["G", "W"],
                        ["G", "W"],
                    ],
                },
            },
            useStack: true,
            effects: [
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { ref: "$source" },
                        filter: { subtype: "Scout" },
                    },
                    then: [
                        {
                            op: "setSubtype",
                            target: { ref: "$source" },
                            subtypes: ["Kithkin", "Soldier"],
                        },
                        {
                            op: "setBasePT",
                            target: { ref: "$source" },
                            power: 4,
                            toughness: 5,
                        },
                    ],
                },
            ],
        },
        {
            id: "figure-of-fable-avatar",
            oracleText:
                "{3}{G/W}{G/W}{G/W}: If this creature is a Soldier, it becomes a Kithkin Avatar with base power and toughness 7/8 and protection from each of your opponents.",
            cost: {
                mana: {
                    generic: 3,
                    hybrid: [
                        ["G", "W"],
                        ["G", "W"],
                        ["G", "W"],
                    ],
                },
            },
            useStack: true,
            effects: [
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { ref: "$source" },
                        filter: { subtype: "Soldier" },
                    },
                    then: [
                        {
                            op: "setSubtype",
                            target: { ref: "$source" },
                            subtypes: ["Kithkin", "Avatar"],
                        },
                        {
                            op: "setBasePT",
                            target: { ref: "$source" },
                            power: 7,
                            toughness: 8,
                        },
                        // CR 702.16j (issue #1748) — the PLAYER quality, whose
                        // opponent set is re-derived live from this permanent's
                        // own controller. Granted with no `duration` (CR
                        // 611.2b): it lasts as long as the permanent does.
                        {
                            op: "grantAbility",
                            target: { ref: "$source" },
                            ability: PROTECTION_FROM_EACH_OPPONENT,
                        },
                    ],
                },
            ],
        },
    ],
};

// Deceit — {4}{U/B}{U/B} Creature — Elemental Incarnation (Vintage Cube
// edict/discard/hand disruption, issue #682). "When this creature enters, if
// {U}{U} was spent to cast it, return up to one other target nonland
// permanent to its owner's hand. When this creature enters, if {B}{B} was
// spent to cast it, target opponent reveals their hand. You choose a nonland
// card from it. That player discards that card. Evoke {U/B}{U/B}." Same shape
// as this file's Vibrance stub above: issue #900 shipped both Evoke itself and
// spent-mana-color tracking, but this card's printed cost {4}{U/B}{U/B} AND
// its evoke cost {U/B}{U/B} both need a hybrid mana pip, which `ManaCost` has
// no representation for. That gap has since CLOSED (PRD #1736 / issue #1738 —
// guild-hybrid pips are declarable and payable with mana), so this card is
// unblocked and simply not yet written; it ships with the hybrid card wave.
// Home file is `multicolor.ts` (a genuine U/B card, hybrid {U/B}{U/B} in its
// cost), NOT `colorless.ts`.
// tracked-by: #1745
// export const deceit: CardDefinition = {
//     id: "bd82c9e4-9871-4e6d-b691-ee00b4b9a3c6",
//     name: "Deceit",
//     rarity: "mythic",
//     manaCost: { X: 4 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 5,
//     toughness: 5,
// };

export {};
