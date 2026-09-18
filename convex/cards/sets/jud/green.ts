// jud — green cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Krosan Reclamation — {1}{G} Instant. "Target player shuffles up to two
// target cards from their graveyard into their library." with Flashback {1}{G}
// (CR 702.34 — cast from the graveyard for the flashback cost, then exile it).
//
// The oracle names two kinds of target (a player + up to two graveyard cards
// from THAT player's graveyard). The engine's single `targetRequirement` yields
// targets of one kind, so — mirroring the established usg/black.ts Duress
// template (a target player + a `choice(zoneOwnerId: { target: 0 })` pick from
// that player's zone) — the player is the announced target and the up-to-two
// graveyard cards are a caster-made `choose-graveyard-card` resolution pick
// scoped to the target player's graveyard (`player: "controller"` chooses,
// `zoneOwnerId: { target: 0 }` names the zone). `count: { min: 0, max: 2 }` is
// the engine's "up to two" idiom (issue #677). The picks then `moveZone`
// graveyard → library (5dn/green.ts Eternal Witness cards-shape) and a trailing
// `libraryLook` shuffle (CR 701.24) randomizes the target player's library.
export const krosanReclamation: CardDefinition = {
    id: "5b3c5144-7e15-46c6-b819-d729ecb30bb1",
    rarity: "uncommon",
    name: "Krosan Reclamation",
    oracleText:
        "Target player shuffles up to two target cards from their graveyard into their library.\nFlashback {1}{G}",
    manaCost: { X: 1, G: 1 },
    types: ["Instant"],
    flashback: { X: 1, G: 1 },
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "choice",
            kind: "choose-graveyard-card",
            player: "controller",
            zoneOwnerId: { target: 0 },
            zone: "graveyard",
            count: { min: 0, max: 2 },
            prompt: "Shuffle up to two target cards from that player's graveyard into their library.",
            bind: "$reclaimed",
        },
        {
            op: "moveZone",
            cards: { ref: "$reclaimed" },
            player: { target: 0 },
            from: "graveyard",
            to: "library",
        },
        { op: "libraryLook", action: "shuffle", player: { target: 0 } },
    ],
};
