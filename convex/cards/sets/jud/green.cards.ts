// jud — green cards (ADR 0043 colour split).
import { defineCard } from "../../types";

// Krosan Reclamation — {1}{G} Instant. "Target player shuffles up to two
// target cards from their graveyard into their library." with Flashback {1}{G}
// (CR 702.34 — cast from the graveyard for the flashback cost, then exile it).
//
// CR 601.2c — the player AND the up-to-two cards are announced targets: the
// card group's `zoneOwnerOfPriorPlayerTarget` binds it to the graveyard of the
// player announced first (Drafna's Restoration's two-group shape). On
// resolution `forEach { set: "targets", zone: "graveyard" }` moves each
// still-legal card (CR 608.2b — one that left the graveyard is skipped) into
// its owner's library, then a `libraryLook` shuffle (CR 701.24) randomizes the
// target player's library.
export const krosanReclamation = defineCard(() => ({
    id: "5b3c5144-7e15-46c6-b819-d729ecb30bb1",
    rarity: "uncommon",
    name: "Krosan Reclamation",
    oracleText:
        "Target player shuffles up to two target cards from their graveyard into their library.\nFlashback {1}{G}",
    manaCost: { X: 1, G: 1 },
    types: ["Instant"],
    flashback: { X: 1, G: 1 },
    targetRequirement: { type: "player", count: 1 },
    additionalTargetRequirements: [
        {
            type: "card",
            count: { min: 0, max: 2 },
            zone: "graveyard",
            controller: "any",
            zoneOwnerOfPriorPlayerTarget: true,
        },
    ],
    effects: [
        {
            op: "forEach",
            select: { set: "targets", zone: "graveyard" },
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$each" },
                    from: "graveyard",
                    to: "library",
                },
            ],
        },
        { op: "libraryLook", action: "shuffle", player: { target: 0 } },
    ],
}));
