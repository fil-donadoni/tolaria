// Coldsnap (CSP) — Colorless: artifacts with no coloured mana cost, split by
// colour per ADR 0043. The registry's `import * as csp from "./sets/csp/index.cards"`
// resolves through csp/index.cards.ts. Modern Scryfall oracle text is authoritative
// (ADR 0004); generic mana is encoded as `X: n`.
import {
    defineCard,
    type DelayedTriggerDef,
    type SpellContext,
} from "../../types";
import { stateTrigger } from "../../abilities/triggers/stateTrigger";

// "Draw a card at the beginning of the next turn's upkeep" cantrip rider
// (CR 603.7d delayed triggered ability). The activating ability calls
// `scheduleNextUpkeepDraw` from its resolve; the matching `DelayedTriggerDef`
// lives on the card's `delayedTriggers[]` and fires exactly once at the very
// next upkeep (`fireDelayedTriggers`, gre/phases.ts). Mirrors the Ice Age
// cantrip cycle (ice/colorless.cards.ts) — copied locally because the helper repeats
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
        // CR 121.1 — the delayed trigger's controller draws one card.
        // Migrated resolve()→effects[] (ADR 0045, closes #1280):
        // DelayedTriggerDef now carries an `effects` site.
        effects: [{ op: "draw", player: "controller", count: 1 }],
    };
}

// Mishra's Bauble — {0} Artifact. "{T}, Sacrifice this artifact: Look at the top
// card of target player's library. Draw a card at the beginning of the next
// turn's upkeep." (CR 605 activated ability; CR 400.2 — a look grants the
// looker persistent knowledge of the card, modelled via the engine's existing
// look-at-top-N mechanism (`peekLibraryTop` + `SpellContext.markKnown`, ADR
// 0026): the top card stays revealed to the controller until it changes zones
// or the library is shuffled. CR 603.7d schedules the delayed draw.)
export const mishrasBauble = defineCard(() => ({
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
                    // CR 400.2 look → markKnown to the controller (ADR
                    // 0026), the same mechanism the other look-at-top-N cards
                    // use (Visions, Diabolic Vision, Portent): the top card
                    // is revealed to the controller and stays visible until
                    // it changes zones or the library is shuffled.
                    const top = ctx.peekLibraryTop(t.id, 1);
                    ctx.markKnown(t.id, top, ctx.controller);
                    // Reveal dialog: show the looked-at card to the controller
                    // in a transient popup (persistent visibility is the
                    // `markKnown` grant above). A private look → audience is the
                    // controller alone.
                    ctx.notifyReveal(
                        [ctx.controller],
                        top,
                        mishrasBauble().id,
                        "look"
                    );
                }
                scheduleNextUpkeepDraw(ctx, mishrasBauble().id);
            },
        },
    ],
    delayedTriggers: [nextUpkeepDrawTrigger()],
}));

// Dark Depths — Legendary Snow Land. "Dark Depths enters with ten ice counters
// on it.\n{3}: Remove an ice counter from Dark Depths.\nWhen Dark Depths has no
// ice counters on it, sacrifice it. If you do, create Marit Lage, a legendary
// 20/20 black Avatar creature token with flying and indestructible."
// CR 122.6 + CR 614.1c: the counters are an enters-with replacement
// (`entersWith`), so a land that enters with none (Blood Moon) never gets them.
// CR 603.8: the last line is a state trigger, re-checked at resolution; the
// source is on the battlefield whenever the re-check holds, so the sacrifice
// ("if you do") always succeeds and the token follows.
// hand-tail: When {self} has no ice counters on it (#7230)
export const darkDepths = defineCard(() => ({
    id: "92409c3a-fb1a-4205-9fe1-0f5affc7b21d",
    name: "Dark Depths",
    rarity: "rare",
    oracleText:
        "Dark Depths enters with ten ice counters on it.\n{3}: Remove an ice counter from Dark Depths.\nWhen Dark Depths has no ice counters on it, sacrifice it. If you do, create Marit Lage, a legendary 20/20 black Avatar creature token with flying and indestructible.",
    manaCost: {},
    supertypes: ["Legendary", "Snow"],
    types: ["Land"],
    entersWith: { counters: [{ type: "ice", count: 10 }] },
    activatedAbilities: [
        {
            id: "dark-depths-remove-ice",
            oracleText: "{3}: Remove an ice counter from Dark Depths.",
            cost: { mana: { X: 3 } },
            useStack: true,
            effects: [
                {
                    op: "counters",
                    action: "remove",
                    counter: "ice",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        },
    ],
    triggeredAbilities: [
        stateTrigger({
            id: "dark-depths-marit-lage",
            oracleText:
                "When Dark Depths has no ice counters on it, sacrifice it. If you do, create Marit Lage, a legendary 20/20 black Avatar creature token with flying and indestructible.",
            condition: (self) => (self.counters?.["ice"] ?? 0) === 0,
            effects: [
                { op: "sacrifice", target: { ref: "$source" } },
                {
                    op: "createToken",
                    token: {
                        name: "Marit Lage",
                        supertypes: ["Legendary"],
                        types: ["Creature"],
                        subtypes: ["Avatar"],
                        power: 20,
                        toughness: 20,
                        colors: ["B"],
                        staticAbilities: ["flying", "indestructible"],
                    },
                    controller: "controller",
                },
            ],
        }),
    ],
}));
