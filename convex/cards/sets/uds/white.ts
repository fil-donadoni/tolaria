// Urza's Destiny (UDS) — white cards (ADR 0043 colour split).
// Modern Scryfall oracle text is authoritative (ADR 0004). Generic mana is
// encoded as `X: n` ({3}{W} → { X: 3, W: 1 }).

import type { CardDefinition } from "../../types";

// CR 404 / 400.7 / 614-batch — a bulk graveyard-set sweep (issue #1056),
// returned as ONE simultaneous event (issue #1094). "Return all enchantment
// cards from your graveyard to the battlefield" is a `forEach` over the
// controller's graveyard filtered to enchantments, `simultaneous: true`: the
// interpreter hands the WHOLE frozen member set to
// `SpellContext.returnGraveyardSetToBattlefield` in one call instead of
// reanimating members one `moveZone` at a time, so no returned enchantment's
// static-effect grants or "enters the battlefield" trigger observe only some
// of the others already on the battlefield (Opalescence/Parallax-style
// interactions). The frozen member set is snapshotted once (CR 608.2i); a
// card leaving mid-resolution is skipped (CR 608.2b).
//
// Aura-with-nothing-to-enchant (CR 303.4c, issue #1094): an Aura in the swept
// set with no legal host — not even a non-Aura sibling entering as part of
// this SAME event — stays in the graveyard rather than entering unattached.
// SIMPLIFICATION: when more than one legal host exists, the batch primitive
// auto-picks the first one (deterministic order) — no player choice is
// modeled, matching this sweep's own "no per-card choice" design for which
// enchantments return.
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
            simultaneous: true,
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
