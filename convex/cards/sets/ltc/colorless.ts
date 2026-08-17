// Tales of Middle-earth Commander (LTC) — Colorless: artifacts with no coloured
// mana cost, split by colour per ADR 0043. The registry's
// `import * as ltc from "./sets/ltc"` resolves through ltc/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004); generic mana is `X: n`.
import type { CardDefinition } from "../../types";

// Relic of Sauron — {4} Artifact. A Grixis mana rock with a card-advantage
// outlet (CR 605.1a mana ability resolves immediately; CR 605 activated
// draw-then-discard goes on the stack and uses stepped resolution so the
// irreversible two-card draw is not re-run when the discard choice suspends,
// CR 608.2).
export const relicOfSauron: CardDefinition = {
    id: "175b3d28-5c74-4972-9b5c-5e39762c78f4",
    name: "Relic of Sauron",
    rarity: "rare",
    oracleText:
        "{T}: Add two mana in any combination of {U}, {B}, and/or {R}.\n{3}, {T}: Draw two cards, then discard a card.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "relic-of-sauron-mana",
            oracleText:
                "{T}: Add two mana in any combination of {U}, {B}, and/or {R}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ U: 2 }),
            // CR 106.1 — every two-pip combination drawn from {U}{B}{R}.
            manaChoices: [
                { U: 2 },
                { U: 1, B: 1 },
                { U: 1, R: 1 },
                { B: 2 },
                { B: 1, R: 1 },
                { R: 2 },
            ],
        },
        {
            id: "relic-of-sauron-draw",
            oracleText: "{3}, {T}: Draw two cards, then discard a card.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            // Migrated resolveSteps()→effects[] (ADR 0045, issue #1264): draw
            // two through the unified suspend-capable draw seam (CR 121.1,
            // ADR 0061), then a `choice`-driven discard of one (CR 701.9) —
            // same shape as Traumatic Critique (sos/multicolor.ts).
            effects: [
                { op: "draw", player: "controller", count: 2 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Choose a card to discard.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        },
    ],
};
