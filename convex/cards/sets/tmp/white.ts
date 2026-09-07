// TMP — white cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

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
// Humility is an Enchantment, not a creature, so it never strips or resizes
// itself.
//
// CR 613.8 (issue #2068) — in layer 6 this card's removal and an ability GRANTED
// by a creature's own static ability (Lord of Atlantis's islandwalk) are
// dependent: applying Humility destroys the existence of the grant (CR 613.8a,
// clause (b)), so CR 613.8b applies the grant last, which is to say never — at
// either timestamp, including a Lord that entered after Humility.
//
// Second, SEPARATE divergence (tracked-by: #3170), not a case of the above:
// the layer-7 walk reads a source's `staticEffects[]` off its definition
// without asking whether layer 6 already suppressed that source's abilities,
// so a lord stripped by this card still hands out its +1/+1 in 7c (measured:
// Humility + two Lord of Atlantis leaves the second at 2/2, CR says 1/1). It
// predates this card — Titania's Song + Mightstone reproduces it with no
// Humility on the board — and the fix is not a gate on suppression alone:
// CR 613.6 keeps the layer-7 part of an ability whose EARLIER-layer part
// already applied, which this engine cannot yet tell apart because one Oracle
// line becomes several independent per-layer `StaticEffect` entries.
// compiler-gap: All creatures lose all abilities and have base power and toughness 1/1. (#2693)
export const humility: CardDefinition = {
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
};
