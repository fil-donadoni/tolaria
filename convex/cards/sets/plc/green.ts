// plc — green cards (ADR 0043 colour split).
import type { CardDefinition, StaticPTSet } from "../../types";

/** Life and Limb's one predicate, shared by all four of its clauses so the
 *  layers cannot disagree about WHAT the card animates. Typed off
 *  `StaticPTSet["applies"]` — the four kinds share the predicate signature, and
 *  naming one of them keeps `tsc` on the hook if it ever diverges.
 *
 *  Read through `ctx.hasSubtype`, i.e. against the LIVE subtype line rather
 *  than the printed one: this card's own layer-4 clause hands a Saproling the
 *  Forest subtype and a Forest the Saproling subtype, and both must keep
 *  matching afterwards (the set is closed — nothing new enters it by being
 *  animated). */
const IS_FOREST_OR_SAPROLING: StaticPTSet["applies"] = (target, _source, ctx) =>
    ctx.hasSubtype(target, "Forest") || ctx.hasSubtype(target, "Saproling");

// Life and Limb — "All Forests and all Saprolings are 1/1 green Saproling
// creatures and Forest lands in addition to their other types." One Oracle
// line, four static effects over ONE predicate ("is a Forest or a Saproling",
// read off the LIVE subtype line so a permanent this card has already made a
// Forest keeps matching), each in the CR 613 layer its clause belongs to:
//   • `type-add` ["Creature", "Land"] (CR 613.1d layer 4) — "in addition to
//     their other types", so a Saproling token becomes a Land and a Forest
//     becomes a Creature, neither losing what it printed;
//   • `subtype-add` ["Saproling", "Forest"] (CR 305.7, same layer) — additive
//     for the same reason, so a Bayou stays Swamp Forest and gains Saproling;
//   • `color-grant` ["G"] (CR 613.1e layer 5) — see the divergence below;
//   • `pt-set` 1/1 (CR 613.4b sublayer 7b) — the kind issue #3161 added. A
//     Saproling token is ALREADY 1/1, which is what makes 7b the only correct
//     home: a 7a `pt-cda` contribution of 1/1 would read 2/2 on it, and a 7c
//     `pt-buff` of 1/1 would too.
// The animated lands are affected by summoning sickness like any other
// creature (CR 302.6) — the reminder text on the card, and nothing the card
// declares: the engine's general rule already answers it.
//
// SIMPLIFICATION (tracked-by: #3169): "are 1/1 GREEN ... creatures" SETS the
// colour (CR 105.2, 613.1e), and the card-declarable `color-grant` only ADDS.
// The registry payload `color-change` has a `set` leg with no producer
// (`gre/layers2to5.ts`). For the two things this card actually animates the
// two answers coincide — a Forest is already mono-green and a Saproling token
// is created green — so the divergence is observable only on a Forest that is
// some OTHER colour first (a Dryad Arbor stolen by a colour-granting effect).
//
// CR 613.8 orders this card's layer-4 effects against Blood Moon / Magus of the
// Moon by DEPENDENCY, not by timestamp (issue #2068): the predicate below reads
// the live subtypes, which their subtype replacement writes, so this card waits
// for them however the two were played.
// compiler-gap: All Forests and all Saprolings are 1/1 green Saproling creatures and Forest lands in addition to their other types. (#2693)
export const lifeAndLimb: CardDefinition = {
    id: "0efe9e8e-7fb3-4a6d-be3d-7965d2ffb0a3",
    rarity: "rare",
    name: "Life and Limb",
    oracleText:
        "All Forests and all Saprolings are 1/1 green Saproling creatures and Forest lands in addition to their other types. (They're affected by summoning sickness.)",
    manaCost: { X: 3, G: 1 },
    types: ["Enchantment"],
    staticEffects: [
        // CR 613.1d — layer 4, the added card types.
        {
            kind: "type-add",
            // CR 613.8a clause (b) — `IS_FOREST_OR_SAPROLING` reads the target's
            // SUBTYPES and nothing else. Conspiracy writes subtypes, so this
            // effect waits for it; Conspiracy's own predicate reads card types,
            // which this effect writes, so it waits back. CR 613.8b: a
            // dependency loop, applied in timestamp order.
            reads: ["subtypes"],
            applies: IS_FOREST_OR_SAPROLING,
            types: ["Creature", "Land"],
        },
        // CR 305.7 — layer 4, the added subtypes.
        {
            kind: "subtype-add",
            reads: ["subtypes"],
            applies: IS_FOREST_OR_SAPROLING,
            subtypes: ["Saproling", "Forest"],
        },
        // CR 613.1e — layer 5. Additive, not a set (tracked-by: #3169).
        {
            kind: "color-grant",
            applies: IS_FOREST_OR_SAPROLING,
            colors: ["G"],
        },
        // CR 613.4b — sublayer 7b, the base-P/T set.
        {
            kind: "pt-set",
            applies: IS_FOREST_OR_SAPROLING,
            power: 1,
            toughness: 1,
        },
    ],
};
