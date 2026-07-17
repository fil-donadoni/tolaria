// Time Spiral (TSP) — Colorless: artifacts with no coloured mana cost, split by
// colour per ADR 0043. The registry's `import * as tsp from "./sets/tsp"`
// resolves through tsp/index.ts. Modern Scryfall oracle text is authoritative
// (ADR 0004); generic mana is encoded as `X: n`.
import type { CardDefinition, SpellContext } from "../../types";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

// Chromatic Star — {1} Artifact. A colour-fixing sac outlet that replaces itself
// on death (CR 605.1a mana ability with a {1} + tap + self-sacrifice cost; CR
// 603.6c leaves-the-battlefield-to-graveyard trigger draws). The death trigger
// fires whether the star is sacrificed for mana or dies any other way, since it
// keys off entering a graveyard from the battlefield.
export const chromaticStar: CardDefinition = {
    id: "1d7a1357-debd-49b0-9fd5-560d5b3f589e",
    name: "Chromatic Star",
    rarity: "common",
    oracleText:
        "{1}, {T}, Sacrifice this artifact: Add one mana of any color.\nWhen this artifact is put into a graveyard from the battlefield, draw a card.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "chromatic-star-mana",
            oracleText:
                "{1}, {T}, Sacrifice this artifact: Add one mana of any color.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "chromatic-star-death-draw",
            oracleText:
                "When this artifact is put into a graveyard from the battlefield, draw a card.",
            scope: "self",
            toZone: "graveyard",
            // NOT DSL-migratable (ADR 0045): the `leftTrigger` factory site
            // only exposes a `resolve` callback, no `effects` alternative —
            // the draw itself is trivially a `draw` Op, but the factory has
            // no field to carry one.
            // Blocked on: extending trigger factories (leftTrigger et al.) to
            // accept `effects`, not a missing Op. tracked-by: #1280
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        }),
    ],
};
