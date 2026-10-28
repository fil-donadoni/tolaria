// FRA — blue cards, split by colour per ADR 0043. The registry's
// `import * as fra from "./sets/fra/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost:
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";

// Sphinx of False Conclusions — {2}{U}{U} Creature — Sphinx Illusion 4/2 (FRA,
// issue #7250, Vintage Cube). Flash, flying; "Whenever this creature attacks,
// draw a card, then discard a card." and "When this creature dies, if it isn't
// a token, create a token that's a copy of it."
//
// Authored DSL-first (ADR 0045) out of shipped Ops: the loot is `draw` →
// `choice` (choose-hand-card) → `discard` (CR 701.9, same shape as
// Currency Converter, `ncc/colorless.cards.ts`); the dies half is
// `createTokenCopy` of `{ ref: "$source" }` (CR 707.2), which recovers the
// dead creature from the last-known copiable values (CR 608.2h / 111.12).
//
// The "if it isn't a token" clause is read at CHECK time off the dying
// permanent (`condition`, CR 603.4) — the token copy carries the same dies
// trigger (CR 707.2), but its own death fails the clause, so the chain ends
// after one copy (precedent: Vaultborn Tyrant, `big/green.cards.ts`).
// hand-tail: it isn't a token (#7250)
export const sphinxOfFalseConclusions = defineCard(() => ({
    id: "08ffbd51-2bd3-4262-8809-09576ce2b6f5",
    name: "Sphinx of False Conclusions",
    rarity: "rare",
    oracleText:
        "Flash\nFlying\nWhenever this creature attacks, draw a card, then discard a card.\nWhen this creature dies, if it isn't a token, create a token that's a copy of it.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Sphinx", "Illusion"],
    power: 4,
    toughness: 2,
    staticAbilities: ["flash", "flying"],
    triggeredAbilities: [
        attacksTrigger({
            id: "sphinx-of-false-conclusions-attack-loot",
            oracleText:
                "Whenever this creature attacks, draw a card, then discard a card.",
            scope: "self",
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Sphinx of False Conclusions: discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        }),
        diedTrigger({
            id: "sphinx-of-false-conclusions-dies-copy",
            oracleText:
                "When this creature dies, if it isn't a token, create a token that's a copy of it.",
            scope: "self",
            condition: (_event, self) => !self.isToken,
            effects: [
                {
                    op: "createTokenCopy",
                    source: { ref: "$source" },
                    controller: "controller",
                },
            ],
        }),
    ],
}));
