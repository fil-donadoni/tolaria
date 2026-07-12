// Urza's Destiny (UDS) — white cards (ADR 0043 colour split).
// Modern Scryfall oracle text is authoritative (ADR 0004). Generic mana is
// encoded as `X: n` ({3}{W} → { X: 3, W: 1 }).

import type { CardDefinition } from "../../types";

// CR 404 / 400.7 — a bulk graveyard-set sweep (issue #1056). "Return all
// enchantment cards from your graveyard to the battlefield" is a `forEach` over
// the controller's graveyard filtered to enchantments, each member reanimated by
// a `moveZone { ref: "$each" } → battlefield` (no per-card choice). The frozen
// member set is snapshotted once (CR 608.2i); a card leaving mid-resolution is
// skipped (CR 608.2b).
//
// KNOWN CR DEVIATIONS (tracked in issue #1094, not blockers for the
// cube-relevant enchantment-permanent recursion this ships for):
//  - Simultaneity: CR 400.7 / 614-batch returns all the cards as ONE event, so
//    no returned enchantment's ETB sees the others already on the battlefield.
//    The `forEach` reanimates one `moveZone` at a time, so a later card's ETB
//    DOES observe earlier ones — divergent for Opalescence/Parallax-style
//    interactions. Needs a batched simultaneous graveyard→battlefield primitive.
//  - Aura-with-nothing-to-enchant: an Aura entering with no legal object stays
//    in the graveyard (CR 303.4) — not yet modelled; such an Aura is currently
//    reanimated regardless.
export const replenish: CardDefinition = {
    id: "7fd2fe13-bbc0-42b7-bc42-3b51910ce118",
    rarity: "rare",
    name: "Replenish",
    oracleText:
        "Return all enchantment cards from your graveyard to the battlefield. (Auras with nothing to enchant remain in your graveyard.)",
    manaCost: { X: 3, W: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "graveyard",
                controller: "controller",
                filter: { type: "Enchantment" },
            },
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$each" },
                    to: "battlefield",
                },
            ],
        },
    ],
};
