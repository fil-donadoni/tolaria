// TMP — white cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Humility — "All creatures lose all abilities and have base power and
// toughness 1/1." Two static effects over the same predicate, one per CR 613
// layer, declared in the order the layers apply but composed independently
// (each layer is its own read, not a chained mutation):
//   • `ability-loss` (CR 613.1f layer 6) strips every creature's abilities —
//     keywords, activated, triggered and intrinsic mana alike;
//   • `pt-set` (CR 613.4b sublayer 7b) replaces every creature's base P/T
//     with 1/1.
// The second is the kind issue #3161 added: `pt-buff` lands in 7c and ADDS,
// and `pt-cda` lands in 7a, where CR 613.4a lets the latest characteristic-
// defining effect overwrite every earlier one and CR 604.3a denies the label
// to an ability defining another object's P/T. So "have base power and
// toughness 1/1" is expressible only in 7b, and a 7c buff still applies over
// it — a Humility'd creature with a +1/+1 counter is 2/2 (CR 613.4c).
// Humility is an Enchantment, not a creature, so it strips and resizes itself
// only while another effect makes it one (Opalescence, below).
//
// CR 613.8 (issue #2068) — in layer 6 this card's removal and an ability GRANTED
// by a creature's own static ability (Lord of Atlantis's islandwalk) are
// dependent: applying Humility destroys the existence of the grant (CR 613.8a,
// clause (b)), so CR 613.8b applies the grant last, which is to say never — at
// either timestamp, including a Lord that entered after Humility.
//
// CR 613.6 — the strip does not take this card's own 1/1 with it when Humility
// is itself a creature (Opalescence): its `ability-loss` has applied to it by
// then, so the `pt-set` of the same ability goes on applying in 7b. A lord it
// strips hands out nothing in 7c, because the lord's ability has no part that
// applied before layer 6 (`survivesAbilityRemoval`, `gre/layers.ts`).
export const humility = defineCard(() => ({
    id: "a2fb7128-806b-4148-80fe-eb967f248021",
    rarity: "rare",
    name: "Humility",
    oracleText:
        "All creatures lose all abilities and have base power and toughness 1/1.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    staticEffects: [
        // CR 613.1f — layer 6, the ability strip.
        {
            kind: "ability-loss",
            applies: (target, _source, ctx) => ctx.isCreature(target),
        },
        // CR 613.4b — sublayer 7b, the base-P/T set.
        {
            kind: "pt-set",
            applies: (target, _source, ctx) => ctx.isCreature(target),
            power: 1,
            toughness: 1,
        },
    ],
}));
