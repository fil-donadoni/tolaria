// BOK — black cards, split by colour per ADR 0043. The registry's
// `import * as bok from "./sets/bok/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Goryo's Vengeance — {1}{B} Instant — Arcane. "Return target legendary
// creature card from your graveyard to the battlefield. That creature gains
// haste. Exile it at the beginning of the next end step." + "Splice onto Arcane
// {2}{B}".
//
// Shallow Grave's script (`mir/black.cards.ts`) with an announced target in
// place of the positional pick: `moveZone` returns the targeted card (CR 400.7,
// a new object), `bind` carries it to the haste grant (CR 702.10) and, through
// the delayed trigger's `capture`, to the next end step (CR 603.7), so the
// exile hits the creature that returned and nothing else (CR 603.7c). The
// haste grant has no duration, as printed. "Legendary" is the graveyard-card
// `supertypeFilter` (CR 205.4a), so the offered and the accepted target sets
// agree. Splice onto Arcane is CR 702.47a, the engine capability
// `gre/splice.ts`; the spliced text rides the spell's own target announcement
// (CR 702.47d).
// hand-tail: Return target legendary creature card from your graveyard to the battlefield. That creature gains haste. Exile it at the beginning of the next end step. (#8806)
export const goryosVengeance = defineCard(() => ({
    id: "3027e6c5-eed3-44e7-bb12-67569721af99",
    name: "Goryo's Vengeance",
    rarity: "rare",
    oracleText:
        "Return target legendary creature card from your graveyard to the battlefield. That creature gains haste. Exile it at the beginning of the next end step.\nSplice onto Arcane {2}{B} (As you cast an Arcane spell, you may reveal this card from your hand and pay its splice cost. If you do, add this card's effects to that spell.)",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    subtypes: ["Arcane"],
    splice: {
        subtype: "Arcane",
        cost: { mana: { X: 2, B: 1 } },
        description: "Splice onto Arcane {2}{B}",
    },
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "you",
        supertypeFilter: "Legendary",
    },
    effects: [
        {
            op: "moveZone",
            target: { target: 0 },
            to: "battlefield",
            bind: "$returned",
        },
        {
            op: "grantAbility",
            ability: "haste",
            target: { ref: "$returned" },
        },
        {
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText: "Exile it at the beginning of the next end step.",
            capture: { $captured: { ref: "$returned" } },
            effects: [{ op: "exile", target: { ref: "$captured" } }],
        },
    ],
}));
