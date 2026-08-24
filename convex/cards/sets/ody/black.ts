// ody — black cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Innocent Blood — "Each player sacrifices a creature of their choice."
// (CR 701.21 sacrifice.) The first DSL card composing a `choice` Op INSIDE a
// forEach construct (ADR 0045, issue #807): the players set iterates in
// APNAP order (CR 101.4 — active player decides first, then each other
// player in turn order); each iteration suspends on a `sacrifice-permanents`
// Pending Choice for the current player (`$each`) and resumes to sacrifice
// the pick. A player with no creatures is skipped entirely (CR 608.2b — the
// choice clamps to zero candidates, so neither the prompt nor the sacrifice
// happens). `simultaneous: true` (issue #1872) is what makes the timing right:
// the interpreter collects EVERY player's pick first and only then applies the
// sacrifices, so a later chooser decides against the board the earlier
// choosers saw — CR 101.4's "Then the actions happen simultaneously", whose
// worked example in the rules text is this card's own line.
export const innocentBlood: CardDefinition = {
    id: "d26af8f6-df64-4027-880c-f2fae2d8103f",
    name: "Innocent Blood",
    rarity: "common",
    oracleText: "Each player sacrifices a creature of their choice.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            // CR 101.4 — "Then the actions happen simultaneously." The rule's
            // own example IS this card: every player chooses in APNAP order,
            // then all chosen creatures are sacrificed together.
            simultaneous: true,
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { ref: "$each" },
                    zone: "battlefield",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Innocent Blood: choose a creature to sacrifice.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        },
    ],
};

// Entomb — {B} Instant. "Search your library for a card, put that card into
// your graveyard, then shuffle." (CR 701.23 search / 400.7 / 701.24 shuffle.) An unrestricted
// tutor straight to the graveyard — `moveZone`'s `to: "graveyard"` branch,
// issue #677.
export const entomb: CardDefinition = {
    id: "f60a2091-fb97-4f04-911b-fce9b6351044",
    name: "Entomb",
    rarity: "rare",
    manaCost: { B: 1 },
    types: ["Instant"],
    oracleText:
        "Search your library for a card, put that card into your graveyard, then shuffle.",
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: 1,
            prompt: "Search your library for a card.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "graveyard",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};
