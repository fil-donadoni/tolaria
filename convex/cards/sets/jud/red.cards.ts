// jud — red cards (ADR 0043 colour split).

import { controlsSubtype, defineCard } from "../../types";

// Anger — {3}{R} Creature — Incarnation 2/2. "Haste" plus "As long as this
// card is in your graveyard and you control a Mountain, creatures you control
// have haste."
//
// The first line is the printed keyword. The second is a static ability that
// states the zone it functions in, so it functions only from there (CR
// 113.6b): a `keyword-grant` declaring `zone: "graveyard"`. The layer walks
// read it from its owner's graveyard and never from the battlefield, so Anger
// on the battlefield grants haste to nothing but itself (its own keyword).
// "You" is the graveyard's owner (CR 109.5), which `graveyardStaticSources`
// presents as the source's controller, so the grant follows Anger into
// whichever graveyard it is in. The Mountain clause is a CR 611.2c source
// gate, re-read at every recompute, so losing the last Mountain ends it.
//
// hand-tail: "As long as this card is in your graveyard and you control a Mountain, creatures you control have haste." (#2602)
export const anger = defineCard(() => ({
    id: "fa2920af-e6a1-4939-ab59-67af4430e5b8", // JUD 77
    rarity: "uncommon",
    name: "Anger",
    oracleText:
        "Haste\nAs long as this card is in your graveyard and you control a Mountain, creatures you control have haste.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Incarnation"],
    power: 2,
    toughness: 2,
    staticAbilities: ["haste"],
    staticEffects: [
        {
            kind: "keyword-grant",
            zone: "graveyard",
            applies: (target, source, ctx) =>
                target.controllerId === source.controllerId &&
                ctx.isCreature(target),
            condition: controlsSubtype("Mountain"),
            keyword: "haste",
        },
    ],
}));
