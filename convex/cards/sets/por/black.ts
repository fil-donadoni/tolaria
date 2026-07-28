// POR — black cards, split by colour per ADR 0043. The registry's
// `import * as por from "./sets/por"` resolves through por/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

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
//
// Home set = earliest paper printing (ADR 0041) = Portal (POR 19); it was
// first implemented against the M11 reprint, which filed it under the wrong
// home set and rendered the wrong art. That printing now rides along as a
// `CardPrint` in `m11/black.ts`.
export const mindRot: CardDefinition = {
    id: "b91d355d-8409-4f0b-87ce-7590a8b9ebc0", // POR 19
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
