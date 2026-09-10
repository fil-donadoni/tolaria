// LTR — colorless cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Palantír of Orthanc (issue #3243). The 2026-08-25 triage named three gaps;
// two had already closed by the time this landed and the third is what this
// slice built:
//
//   * an OPPONENT-made may-choice inside the controller's own trigger — a
//     `mayPay` whose `player` is a generic `EffectPlayerRef`, shipped and in
//     use by Questing Phelddagrif (`pls/multicolor.ts`) and Sibilant Spirit
//     (`ice/blue.ts`). Not a punisher `mayPay` with a cost: this one is the
//     bare cost-free "you may" shape (issue #680);
//   * an amount read off a NAMED counter on the source — the `counters`
//     EffectValue member (CR 122.6, issue #1015), which The One Ring below
//     already reads the same way;
//   * a life-loss amount equal to the total mana value of the cards a
//     preceding `mill` moved. THAT was the real gap, and it needed two halves:
//     `mill`'s `bindAll` (issue #2600) to bind the whole milled set rather
//     than only its first card, and the `sum` EffectValue member (issue #3243)
//     to total one characteristic across that bound set. Both are general —
//     nothing in either names this card.
//
// compiler-gap: "Then target opponent may have you draw a card. If that player doesn't, you mill X cards, where X is the number of influence counters on Palantír of Orthanc, and that player loses life equal to the total mana value of those cards." (#2693)
export const palantirOfOrthanc: CardDefinition = {
    id: "6efb6a69-562c-4d95-858d-b067444cfd7e",
    name: "Palantír of Orthanc",
    rarity: "mythic",
    oracleText:
        "At the beginning of your end step, put an influence counter on Palantír of Orthanc and scry 2. Then target opponent may have you draw a card. If that player doesn't, you mill X cards, where X is the number of influence counters on Palantír of Orthanc, and that player loses life equal to the total mana value of those cards.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    // CR 205.4a — "Legendary Artifact"; the legend rule (CR 704.5j) applies
    // only via this supertype.
    supertypes: ["Legendary"],
    triggeredAbilities: [
        phaseTrigger({
            id: "palantir-of-orthanc-end-step",
            oracleText:
                "At the beginning of your end step, put an influence counter on Palantír of Orthanc and scry 2. Then target opponent may have you draw a card. If that player doesn't, you mill X cards, where X is the number of influence counters on Palantír of Orthanc, and that player loses life equal to the total mana value of those cards.",
            phase: "END_STEP",
            scope: "your",
            // CR 603.3d — the opponent is announced as the trigger goes on the
            // stack, so the `mayPay` below can address `{ target: 0 }`. In a
            // two-player game the slot has exactly one legal occupant, which is
            // why the card carries no announcement DECISION for the bot to make
            // (see the PR's Bot reachability walk).
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                // CR 608.2c — the controller follows the instructions in the
                // order written, so the counter goes on FIRST and the mill
                // below reads a count INCLUDING it (CR 122.6) ("put an influence counter on Palantír
                // of Orthanc … you mill X cards, where X is the number of
                // influence counters on Palantír of Orthanc"). The first
                // trigger therefore mills 1, not 0.
                {
                    op: "counters",
                    action: "add",
                    counter: "influence",
                    target: { ref: "$source" },
                    count: 1,
                },
                // CR 701.22 Scry 2 — the controller looks at the top two and
                // decides which go to the bottom. `chooser` is deliberately
                // unset: the library's own owner decides, which is what makes
                // this a scry rather than a fateseal (CR 701.29).
                {
                    op: "scryReorder",
                    player: "controller",
                    count: 2,
                    destination: "library-bottom",
                },
                // CR 608.2d / 121.3a — "target opponent MAY have you draw a
                // card": the choice is announced while the effect is applied,
                // and CR 121.3a is explicit that the player MAKING it need not
                // be the player who would draw. It costs them nothing. The
                // cost-free `mayPay` shape (issue #680) with a non-controller
                // `player` is exactly that, and the required boolean `bind` is
                // what the punisher branch below reads.
                {
                    op: "mayPay",
                    player: { target: 0 },
                    prompt: "Have Palantír of Orthanc's controller draw a card?",
                    bind: "$letThemDraw",
                },
                {
                    op: "if",
                    predicate: { binding: "$letThemDraw" },
                    then: [{ op: "draw", player: "controller", count: 1 }],
                    // "If that player doesn't" — the punisher half. Both Ops
                    // run: milling zero cards (an empty library) still loses 0
                    // life rather than skipping the clause, because `sum` over
                    // an uncaptured binding is 0 (CR 608.2 — the effect does as
                    // much as it can).
                    else: [
                        // CR 701.17a mill; X is the LIVE influence count on
                        // the source (CR 122.6), read at resolution in the
                        // order written (CR 608.2c) — the same way The One
                        // Ring's upkeep loss reads its burden counters. A
                        // library shorter than X mills as many as possible
                        // (CR 701.17b). `bindAll`
                        // (issue #2600) captures every card that genuinely
                        // reached the graveyard, in mill order — a short
                        // library mills what it has, and the sum below covers
                        // only those cards.
                        {
                            op: "mill",
                            player: "controller",
                            count: {
                                counters: {
                                    of: { ref: "$source" },
                                    type: "influence",
                                },
                            },
                            bindAll: "$milled",
                        },
                        // CR 119.3 / 202.3 — ONE loss of the total, not one
                        // loss per card: a per-card `forEach` would be a
                        // different game action (N life-loss events, N CR 614
                        // replacement windows). `{X}` in a milled card's cost
                        // counts as 0 outside the stack (CR 202.3e), which the
                        // registry's own mana-value read already folds.
                        //
                        // simplification: a milled card that a CR 614 graveyard-bound replacement sends elsewhere is not counted, though CR 701.17c says a milled card can be found in whatever public zone it reached — out-of-scope here, the miss is upstream in `mill`'s `bindAll` (#2600), which binds only cards that reached the graveyard; see docs/findings/3243-milled-card-redirected-out-of-the-graveyard.md
                        {
                            op: "loseLife",
                            player: { target: 0 },
                            amount: {
                                sum: {
                                    of: { ref: "$milled" },
                                    read: "manaValue",
                                    zone: "graveyard",
                                    player: "controller",
                                },
                            },
                        },
                    ],
                },
            ],
        }),
    ],
};

// The One Ring (issue #674). Every clause is declarative: the keyword rides
// `staticAbilities`, and all three abilities are Effect Scripts (ADR 0045) —
// no `resolve()` closure anywhere on the card.
//
// The ETB clause needed the one genuinely new engine capability: PLAYER-scoped
// protection from everything (CR 702.16b/e/i applied to a player via CR 115.4).
// Before this card, `gre/protection.ts` handled only the colour-parametrized,
// permanent-scoped keyword. It now also owns the single predicate
// `playerHasProtectionFromEverything`, read by the targeting gate in BOTH
// `getLegalTargets` and the `selectTarget` mutation (so the offered set and
// the accepted set can't diverge) and by `applyPlayerDamagePrevention` (the
// one chokepoint every player-damage sink routes through). The Op
// `setProtectionFromEverything` is its declarative skin.
export const theOneRing: CardDefinition = {
    // The BASE LTR printing (collector #246, black border, no `boosterfun`).
    // The stub's id was the serialized 1-of-1 (collector #0, `serialized` +
    // borderless) — a promo treatment, not the card's first/normal print, so it
    // would have pulled the wrong art.
    id: "d5806e68-1054-458e-866d-1f2470f682b2",
    name: "The One Ring",
    rarity: "mythic",
    oracleText:
        "Indestructible\nWhen The One Ring enters, if you cast it, you gain protection from everything until your next turn.\nAt the beginning of your upkeep, you lose 1 life for each burden counter on The One Ring.\n{T}: Put a burden counter on The One Ring, then draw a card for each burden counter on The One Ring.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    // CR 205.4a — "Legendary Artifact"; the legend rule (CR 704.5j) applies
    // only via this supertype.
    supertypes: ["Legendary"],
    // CR 702.12 — Indestructible. Declared literally (Mechanics Registry row
    // `indestructible`, status "implemented"): the SBA 704.5g destroy skip and
    // `regenerateOrDestroy` both read the effective ability list, so a printed
    // keyword works exactly like a layer-6 grant.
    staticAbilities: ["indestructible"],
    triggeredAbilities: [
        enteredTrigger({
            id: "the-one-ring-etb-protection",
            oracleText:
                "When The One Ring enters, if you cast it, you gain protection from everything until your next turn.",
            scope: "self",
            // CR 603.4 check-time condition — "if you cast it" reads the
            // `wasCast` flag `finalizeSpellResolution` stamps ONLY at the
            // cast-resolution chokepoint (`PermanentEnteredEvent.wasCast`), so
            // a One Ring reanimated, flickered or otherwise put onto the
            // battlefield grants no protection. Same shape as Lutri, the
            // Spellchaser (iko/multicolor.ts).
            condition: (event) => event.wasCast === true,
            effects: [
                // CR 702.16b/e/i — "you" is the source's controller: an ETB
                // ability always belongs to the permanent that has it, so
                // `ctx.controller` inside the script is The One Ring's
                // controller. The "until your next turn" boundary is intrinsic
                // to the Op (cleared at the grantee's next turn start in
                // `advanceTurn`, NOT at CLEANUP — the protection has to cover
                // the whole intervening opponent turn).
                { op: "setProtectionFromEverything", player: "controller" },
            ],
        }),
        phaseTrigger({
            id: "the-one-ring-upkeep-burden",
            oracleText:
                "At the beginning of your upkeep, you lose 1 life for each burden counter on The One Ring.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                // CR 122.6 — the amount is the LIVE burden count on the
                // source; with no counters yet the trigger still resolves and
                // costs 0 life (there is no intervening-if on this ability).
                {
                    op: "loseLife",
                    player: "controller",
                    amount: {
                        counters: { of: { ref: "$source" }, type: "burden" },
                    },
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "the-one-ring-draw",
            oracleText:
                "{T}: Put a burden counter on The One Ring, then draw a card for each burden counter on The One Ring.",
            cost: { tap: true },
            useStack: true,
            effects: [
                // CR 608.2c — the counter goes on FIRST…
                {
                    op: "counters",
                    action: "add",
                    counter: "burden",
                    target: { ref: "$source" },
                    count: 1,
                },
                // …and the draw then reads the count INCLUDING it ("then draw
                // a card for each burden counter"), because the `counters`
                // value reads the live battlefield permanent (CR 122.6). The
                // first activation therefore draws 1, not 0.
                {
                    op: "draw",
                    player: "controller",
                    count: {
                        counters: { of: { ref: "$source" }, type: "burden" },
                    },
                },
            ],
        },
    ],
};
