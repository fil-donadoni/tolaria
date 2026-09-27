// wth — green cards (ADR 0043 colour split).
import type { CardDefinition, GameEvent } from "../../types";

// Gaea's Blessing — {1}{G} Sorcery (issue #1055 — the mill / library→graveyard
// zone-change trigger). Oracle (three clauses):
//   1. "Target player shuffles up to three target cards from their graveyard
//      into their library." — the Krosan Reclamation composition (jud/green):
//      a caster-made `choose-graveyard-card` pick (min 0, max 3) scoped to the
//      target player's graveyard, `moveZone` graveyard→library, then a trailing
//      `libraryLook` shuffle (CR 701.24) randomizes that player's library.
//   2. "Draw a card." — the resolving controller draws (CR 121.1).
//   3. "When this card is put into your graveyard from your library, shuffle
//      your graveyard into your library." — a `zone: "graveyard"` triggered
//      ability listening for CARD_MILLED (issue #1055), self-scoped by
//      instance id, that shuffles the OWNER's whole graveyard back into their
//      library.
//
// Clause 3 is `moveZone`'s whole-zone shape (graveyard → library, issue
// #1279) + a `libraryLook` shuffle — Feldon's Cane's composition
// (atq/colorless). Both Ops name `{ ref: "$event.ownerId" }`: the milled
// card's owner is the player whose library it left (CR 701.17 — a mill never
// crosses owners), whoever caused the mill. CR 113.8 / 108.4a make that owner
// the trigger's controller too, but the engine copies the trigger's
// controller from the source's `controllerId`, which a card cast by a
// non-owner can still carry, so the event is the field to read.
export const gaeasBlessing: CardDefinition = {
    id: "ee83d511-57e0-40fb-a4db-62f6c2c39888",
    rarity: "uncommon",
    name: "Gaea's Blessing",
    oracleText:
        "Target player shuffles up to three target cards from their graveyard into their library.\nDraw a card.\nWhen this card is put into your graveyard from your library, shuffle your graveyard into your library.",
    manaCost: { X: 1, G: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "choice",
            kind: "choose-graveyard-card",
            player: "controller",
            zoneOwnerId: { target: 0 },
            zone: "graveyard",
            count: { min: 0, max: 3 },
            prompt: "Shuffle up to three target cards from that player's graveyard into their library.",
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
        { op: "draw", player: "controller", count: 1 },
    ],
    triggeredAbilities: [
        {
            id: "gaeas-blessing-mill-shuffle",
            oracleText:
                "When this card is put into your graveyard from your library, shuffle your graveyard into your library.",
            event: "CARD_MILLED",
            // CR 603.6e — functions while the source sits in the graveyard (it
            // was just milled there); opt into collectTriggers' graveyard scan.
            zone: "graveyard",
            // Self-scoped: fire only for THIS card's own mill (CR 603.2b).
            matches: (event: GameEvent, self) =>
                event.type === "CARD_MILLED" &&
                event.cardInstanceId === self.id,
            // CR 701.24 — shuffle the OWNER's graveyard into their library:
            // Feldon's Cane's composition (atq/colorless.ts), aimed at the
            // milled card's owner read off the firing event.
            effects: [
                {
                    op: "moveZone",
                    player: { ref: "$event.ownerId" },
                    from: "graveyard",
                    to: "library",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: { ref: "$event.ownerId" },
                },
            ],
        },
    ],
};
