// DOM — white cards, split by colour per ADR 0043. The registry's
// `import * as dom from "./sets/dom"` resolves through dom/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { KNIGHT_TOKEN } from "../../sharedTokens";

// History of Benalia — {1}{W}{W} Enchantment — Saga (CR 714), the reference
// card for the Saga framework (ADR 0078, issue #1879).
//
//   I, II — Create a 2/2 white Knight creature token with vigilance.
//   III   — Knights you control get +2/+1 until end of turn.
//
// Fully declarative: `chapterAbilities[]` is desugared at the `getDefinition`
// seam (`cards/abilities/sagas.ts`) into `COUNTER_ADDED` triggers carrying the
// CR 714.2b crossing condition, plus the CR 714.3a entry lore counter. "I, II"
// is ONE entry with `chapters: [1, 2]` (CR 714.2c) — one Oracle line, one
// ability on the stack, per the one-Oracle-line-one-TriggeredAbility standard.
// Both chapters reuse already-exercised Ops (`createToken`, `forEach` +
// `pump`), so the per-Op test regime applies.
//
// `oracleText` is VERBATIM Scryfall, stale reminder text included: the printed
// parenthetical still says "after your draw step", wording that predates
// Dominaria United's move to "as a player's precombat main phase begins"
// (CR 714.3c). Reminder text carries no rules meaning (CR 207.2) and the
// catalogue's provenance convention is to ship Oracle text unedited — the
// engine follows 714.3c regardless.
export const historyOfBenalia: CardDefinition = {
    id: "d134385d-b01c-41c7-bb2d-30722b44dc5a",
    name: "History of Benalia",
    rarity: "mythic",
    oracleText:
        "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI, II — Create a 2/2 white Knight creature token with vigilance.\nIII — Knights you control get +2/+1 until end of turn.",
    manaCost: { X: 1, W: 2 },
    types: ["Enchantment"],
    subtypes: ["Saga"],
    chapterAbilities: [
        {
            chapters: [1, 2],
            oracleText:
                "I, II — Create a 2/2 white Knight creature token with vigilance.",
            effects: [
                {
                    op: "createToken",
                    token: KNIGHT_TOKEN,
                    controller: "controller",
                },
            ],
        },
        {
            chapters: [3],
            oracleText:
                "III — Knights you control get +2/+1 until end of turn.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { subtype: "Knight" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 2,
                            toughness: 1,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
};
