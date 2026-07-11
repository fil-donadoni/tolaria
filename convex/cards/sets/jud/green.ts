// jud — green cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Sylvan Safekeeper — {G} Creature — Human Wizard (issue #684, Cube FREE
// evasion/protection statics). "Sacrifice a land: Target creature you
// control gains shroud until end of turn." (CR 702.18 shroud; CR 118.5
// sacrifice-a-permanent activation cost.)
//
// Deviation (documented per gre-development.md — "planned" registry status
// is a legal declaration, not a block; mechanicsRegistry.ts note: "GAP:
// granted via SpellContext.grantStaticAbility on multiple fem/blue.ts cards
// but no target-legality check anywhere reads the string — decorative only,
// same class as haste"): shroud is granted the same way haste/hexproof are
// elsewhere in the catalogue — the keyword is placed on the target, but no
// targeting-legality check currently reads it, so the granted shroud is
// presently decorative rather than rules-enforced. Not specific to this
// card; tracked project-wide, not a stop-and-issue case for a single card.
export const sylvanSafekeeper: CardDefinition = {
    id: "f1b8413f-c9fc-4cea-b416-a1fcf651b009",
    name: "Sylvan Safekeeper",
    rarity: "rare",
    oracleText:
        "Sacrifice a land: Target creature you control gains shroud until end of turn.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "sylvan-safekeeper-shroud",
            oracleText:
                "Sacrifice a land: Target creature you control gains shroud until end of turn.",
            cost: { sacrificeFilter: { types: "Land" } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            effects: [
                {
                    op: "grantAbility",
                    ability: "shroud",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

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
