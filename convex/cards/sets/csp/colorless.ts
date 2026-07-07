// Coldsnap (CSP) — Colorless: artifacts with no coloured mana cost, split by
// colour per ADR 0043. The registry's `import * as csp from "./sets/csp"`
// resolves through csp/index.ts. Modern Scryfall oracle text is authoritative
// (ADR 0004); generic mana is encoded as `X: n`.
import type {
    CardDefinition,
    DelayedTriggerDef,
    SpellContext,
} from "../../types";

// "Draw a card at the beginning of the next turn's upkeep" cantrip rider
// (CR 603.7d delayed triggered ability). The activating ability calls
// `scheduleNextUpkeepDraw` from its resolve; the matching `DelayedTriggerDef`
// lives on the card's `delayedTriggers[]` and fires exactly once at the very
// next upkeep (`fireDelayedTriggers`, gre/phases.ts). Mirrors the Ice Age
// cantrip cycle (ice/colorless.ts) — copied locally because the helper repeats
// per-colour-module across sets.
const NEXT_UPKEEP_DRAW_TRIGGER_ID = "next-upkeep-cantrip";

function scheduleNextUpkeepDraw(ctx: SpellContext, sourceCardId: string): void {
    ctx.scheduleDelayedTrigger(
        sourceCardId,
        NEXT_UPKEEP_DRAW_TRIGGER_ID,
        "next-upkeep",
        {}
    );
}

function nextUpkeepDrawTrigger(): DelayedTriggerDef {
    return {
        id: NEXT_UPKEEP_DRAW_TRIGGER_ID,
        oracleText: "Draw a card at the beginning of the next turn's upkeep.",
        timing: "next-upkeep",
        resolve: (ctx) => {
            ctx.drawCards(ctx.controller, 1);
        },
    };
}

// Mishra's Bauble — {0} Artifact. "{T}, Sacrifice this artifact: Look at the top
// card of target player's library. Draw a card at the beginning of the next
// turn's upkeep." (CR 605 activated ability; CR 701.18a — a look grants the
// looker persistent knowledge of the card, modelled via the engine's existing
// look-at-top-N mechanism (`peekLibraryTop` + `SpellContext.markKnown`, ADR
// 0026): the top card stays revealed to the controller until it changes zones
// or the library is shuffled. CR 603.7d schedules the delayed draw.)
export const mishrasBauble: CardDefinition = {
    id: "8a720448-017f-4f4a-9501-678245eaed17",
    name: "Mishra's Bauble",
    rarity: "uncommon",
    oracleText:
        "{T}, Sacrifice this artifact: Look at the top card of target player's library. Draw a card at the beginning of the next turn's upkeep.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "mishras-bauble-look",
            oracleText:
                "{T}, Sacrifice this artifact: Look at the top card of target player's library. Draw a card at the beginning of the next turn's upkeep.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "player") {
                    // CR 701.18a look → markKnown to the controller (ADR
                    // 0026), the same mechanism the other look-at-top-N cards
                    // use (Visions, Diabolic Vision, Portent): the top card
                    // is revealed to the controller and stays visible until
                    // it changes zones or the library is shuffled.
                    const top = ctx.peekLibraryTop(t.id, 1);
                    ctx.markKnown(t.id, top, ctx.controller);
                }
                scheduleNextUpkeepDraw(ctx, mishrasBauble.id);
            },
        },
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
};
