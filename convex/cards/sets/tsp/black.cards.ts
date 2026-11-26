// tsp — black cards (ADR 0043 colour split).
import { defineCard } from "../../types";

// Living End — Sorcery, no mana cost (TSP). Suspend 3—{2}{B}{B} (CR 702.62a,
// the `suspend` cost plus the "suspend 3" keyword string). No `manaCost`: CR
// 118.6's unpayable cost, so it is cast only for free (suspend's last-counter
// cast, cascade). CR 608.2c — the steps run in the order written, each for
// every player: the creature cards in every graveyard are exiled, stamped as
// exiled by this spell, then every creature is sacrificed (CR 701.21a) — those
// reach the graveyard after the exile, so they stay there — then the stamped
// pile enters as ONE batch (`simultaneous`), each card under its owner's
// control (CR 110.2a), so every returned creature's entry trigger sees the
// others already in.
// hand-tail: Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield. (#10496)
export const livingEnd = defineCard(() => ({
    id: "3be0ff69-d9f3-4b81-b02f-1360e4064aff", // TSP 115
    name: "Living End",
    rarity: "rare",
    oracleText:
        "Suspend 3—{2}{B}{B} (Rather than cast this card from your hand, pay {2}{B}{B} and exile it with three time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)\nEach player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield.",
    types: ["Sorcery"],
    // CR 202.2e — its black color indicator is not modeled: with no mana cost
    // the card reads colorless. tracked-by: #10761
    staticAbilities: ["suspend 3"],
    suspend: { X: 2, B: 2 },
    effects: [
        {
            op: "forEach",
            select: { set: "graveyard", filter: { type: "Creature" } },
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$each" },
                    from: "graveyard",
                    to: "exile",
                    linkToSource: true,
                },
            ],
        },
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [{ op: "sacrifice", target: { ref: "$each" } }],
        },
        {
            op: "forEach",
            select: { set: "exiledWithSource" },
            simultaneous: true,
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$each" },
                    from: "exile",
                    to: "battlefield",
                },
            ],
        },
    ],
}));
