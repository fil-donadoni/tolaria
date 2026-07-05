// usg — black cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Exhume — {1}{B} Sorcery. "Each player puts a creature card from their
// graveyard onto the battlefield." (CR 400.7 reanimation, CR 101.4 APNAP
// order.) The Innocent Blood pattern (forEach players + a per-player choice,
// ADR 0045 issue #807): each player picks their OWN creature card via
// `choose-graveyard-card` (chooser = zone owner = `$each`), then the
// `moveZone` cards-shape's `from: "graveyard"` source (issue #680) puts it
// onto the battlefield under that SAME player's control (the default —
// "each player… onto the battlefield" needs no controller override). A
// player with no creature cards in their graveyard is skipped entirely (CR
// 608.2b — the choice clamps to zero candidates).
export const exhume: CardDefinition = {
    id: "a88b23ce-ce19-47da-b9f2-055a4d6bdc79",
    name: "Exhume",
    rarity: "common",
    oracleText:
        "Each player puts a creature card from their graveyard onto the battlefield.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: { ref: "$each" },
                    zone: "graveyard",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Exhume: put a creature card from your graveyard onto the battlefield.",
                    bind: "$exhumed",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$exhumed" },
                    player: { ref: "$each" },
                    from: "graveyard",
                    to: "battlefield",
                },
            ],
        },
    ],
};
