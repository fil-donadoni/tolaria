// m11 — black cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Mind Rot — "Target player discards two cards." (CR 701.9 discard.) The
// first DSL card with a MID-RESOLUTION choice (ADR 0045, issue #805): the
// script suspends at the `choice` Op — the targeted player picks the two
// cards through the existing `discard-hand` Pending Choice (same prompt UI,
// same generic `submitResolutionChoice` mutation as every imperative
// discard) — then resumes at the `discard` Op, which consumes the picks
// binding. The pick count clamps to the hand (CR 701.9b — fewer cards means
// discard that many; an empty hand skips the choice and the discard
// entirely, CR 608.2b).
export const mindRot: CardDefinition = {
    id: "5e117056-030a-4ec6-a669-dbe6c7ccb840",
    name: "Mind Rot",
    rarity: "common",
    oracleText: "Target player discards two cards.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "choice",
            kind: "discard-hand",
            player: { target: 0 },
            zone: "hand",
            count: 2,
            prompt: "Mind Rot: choose two cards to discard.",
            bind: "$discards",
        },
        { op: "discard", player: { target: 0 }, cards: { ref: "$discards" } },
    ],
};
