// ody — black cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Innocent Blood — "Each player sacrifices a creature of their choice."
// (CR 701.16 sacrifice.) The first DSL card composing a `choice` Op INSIDE a
// forEach construct (ADR 0045, issue #807): the players set iterates in
// APNAP order (CR 101.4 — active player decides first, then each other
// player in turn order); each iteration suspends on a `sacrifice-permanents`
// Pending Choice for the current player (`$each`) and resumes to sacrifice
// the pick. A player with no creatures is skipped entirely (CR 608.2b — the
// choice clamps to zero candidates, so neither the prompt nor the sacrifice
// happens). Engine simplification (flagged): each iteration's sacrifice
// applies before the next player picks, rather than all sacrifices happening
// simultaneously after all choices (CR 101.4d).
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
