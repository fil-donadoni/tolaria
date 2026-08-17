// NEM — blue cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem"` resolves through nem/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { holdsExileBundle } from "../../abilities/exileBundle";

// Parallax Tide — "Fading 5 (…) Remove a fade counter from this enchantment:
// Exile target land. When this enchantment leaves the battlefield, each player
// returns to the battlefield all cards they own exiled with it."
// (CR 702.32 Fading; CR 701.13 exile; CR 603.7a leaves-the-battlefield.)
//
// The blue land-exiling half of the Parallax Wave cycle — identical structure
// (see nem/white.ts for the full rationale), the only divergence being the
// target type (`Land` instead of `Creature`). Fading 5 rides the getDefinition
// seam (ADR 0054); the exile-and-return bundle is the DSL-first (ADR 0045)
// `exileWithAttachments` / `returnExiledForSource` Op pair (ADR 0028).
const PARALLAX_TIDE_ID = "7fe593eb-df3c-43e5-97a6-418f91e87cb3"; // NEM 37
export const parallaxTide: CardDefinition = {
    id: PARALLAX_TIDE_ID,
    name: "Parallax Tide",
    rarity: "rare",
    oracleText:
        "Fading 5 (This enchantment enters with five fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)\nRemove a fade counter from this enchantment: Exile target land.\nWhen this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.",
    manaCost: { X: 2, U: 2 },
    types: ["Enchantment"],
    staticAbilities: ["fading 5"],
    activatedAbilities: [
        {
            id: "parallax-tide-exile",
            oracleText:
                "Remove a fade counter from this enchantment: Exile target land.",
            cost: { removeCounter: { type: "fade", count: 1 } },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            // CR 701.13 host-only exile; ADR 0028 arms the keyed return. Op
            // defaults includeAttachments/returnTapped false (host-only).
            effects: [{ op: "exileWithAttachments", target: { target: 0 } }],
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "parallax-tide-return",
            oracleText:
                "When this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.",
            scope: "self",
            condition: holdsExileBundle,
            effects: [{ op: "returnExiledForSource" }],
        }),
    ],
};

// Accumulated Knowledge — {1}{U} Instant. "Draw a card, then draw cards equal
// to the number of cards named Accumulated Knowledge in all graveyards."
// (CR 121.1 draw; CR 122 counting; CR 201.2 name match.) First printed in
// Nemesis (issue #985 said mmq/blue.ts, but the card has no Mercadian Masques
// printing — its earliest set is Nemesis, so it lives here per ADR 0043).
//
// DSL-first (ADR 0045): two sequential `draw` Ops, no new Op. The first draws
// the base card; the second draws one per copy of this card in ANY graveyard,
// via the existing `count` value construct generalized with `acrossAllPlayers`
// (CR 122 — "in all graveyards") and a `name` filter (CR 201.2 — "cards named
// Accumulated Knowledge"). The resolving copy is on the stack, not a graveyard,
// so it is naturally excluded: 0 copies in graveyards → draw 1; 1 copy → draw 2.
export const accumulatedKnowledge: CardDefinition = {
    id: "ab061406-38f4-40e7-a9ea-e3cbcaabc127", // NEM 26
    rarity: "common",
    name: "Accumulated Knowledge",
    oracleText:
        "Draw a card, then draw cards equal to the number of cards named Accumulated Knowledge in all graveyards.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    effects: [
        { op: "draw", player: "controller", count: 1 },
        {
            op: "draw",
            player: "controller",
            count: {
                count: {
                    zone: "graveyard",
                    acrossAllPlayers: true,
                    filter: { name: "Accumulated Knowledge" },
                },
            },
        },
    ],
};

// Dominate — {X}{1}{U}{U} Instant. "Gain control of target creature with mana
// value X or less." A targeted layer-2 control change (CR 613.1b) filtered by
// mana value (CR 202.3). The control change is INDEFINITE (no "for as long
// as" clause), so the `gainControl` Op omits `duration` — the Ghazbán Ogre
// shape that never reverts on its own (issue #848).
//
// The X-dependent mana-value ceiling rides `mvFilter: { max: "X" }`, which the
// engine resolves against the chosen X at announcement (CR 107.3), restricting
// legal targets in `getLegalTargets` to creatures whose mana value is X or
// less. `{X}{1}{U}{U}` = variable X plus one fixed generic and {U}{U}, encoded
// as `X: "X"` (the variable marker) + `generic: 1` + `U: 2`.
export const dominate: CardDefinition = {
    id: "63b2dcb1-8c3e-434c-865a-196d4d799706",
    rarity: "uncommon",
    name: "Dominate",
    oracleText: "Gain control of target creature with mana value X or less.",
    manaCost: { X: "X", generic: 1, U: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        mvFilter: { max: "X" },
    },
    effects: [
        {
            op: "gainControl",
            target: { target: 0 },
            controller: "controller",
        },
    ],
};

// Daze — {1}{U} Instant. "You may return an Island you control to its owner's
// hand rather than pay this spell's mana cost. Counter target spell unless its
// controller pays {1}." (CR 118.9 alternative pitch cost — return an Island;
// CR 400.7 return; CR 701.6a counter-unless-pay; CR 117.3a may-pay.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// the existing PERMANENT `action: "return"` leg (Gush's shape) narrowed to a
// single Island. The counter-unless-pay effect is the shipped Mana Tithe / Force
// Spike shape — a `mayPay` on the spell's controller + `if (not $paid) counter`,
// both already-censused Ops (ADR 0045, DSL-first).
export const daze: CardDefinition = {
    id: "d03bff25-0d5e-4dcf-8d75-6df846afea3b", // NEM 30
    rarity: "common",
    name: "Daze",
    oracleText:
        "You may return an Island you control to its owner's hand rather than pay this spell's mana cost.\nCounter target spell unless its controller pays {1}.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    alternativeCosts: [
        {
            id: "pitch-return-island",
            description: "Return an Island you control to its owner's hand",
            permanent: {
                action: "return",
                count: 1,
                filter: { subtypes: "Island" },
            },
        },
    ],
    effects: [
        {
            op: "mayPay",
            // CR 117.3a — the countered spell's controller decides whether to pay.
            player: { controllerOf: { target: 0 } },
            cost: { X: 1 },
            prompt: "Pay {1} to prevent your spell from being countered?",
            bind: "$paid",
        },
        {
            // CR 701.6a — counter unless the payment was made.
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};
