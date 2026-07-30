// PLS (Planeshift) — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { drawTrigger } from "../../abilities/triggers/drawTrigger";

// Keldon Twilight — {1}{B}{R} Enchantment. "At the beginning of each player's
// end step, if no creatures attacked this turn, that player sacrifices a
// creature of their choice that they controlled since the beginning of the
// turn." (issue #1944, parent PRD #1935.)
//
// Three CR clauses, all data:
//
//  * "each player's end step" — `phaseTrigger({ phase: "END_STEP", scope:
//    "each" })` (CR 603.6a). The sacrificing player is "that player", i.e. the
//    player whose end step it is, read inside the Effect Script as
//    `{ ref: "$event.activePlayerId" }` (issue #1066 / ADR 0049) rather than
//    the plain `"controller"` selector — under `scope: "each"` the two are
//    different players on the opponent's turn, and only the event ref is
//    correct under any scope.
//
//  * "if no creatures attacked this turn" — a CR 603.4 intervening-if, so the
//    factory checks it BOTH when the trigger would fire and again immediately
//    before it resolves (CR 603.4d); an attack declared in between is
//    impossible, but a resolution-time re-check is what the rule says and what
//    `phaseTrigger` wires for free. It reads the GAME-level
//    `creatureAttackedThisTurn` flag, not a scan of the per-creature
//    `hasAttackedThisTurn` flags: CR 506.4 keeps a creature that attacked
//    "having attacked" after it leaves combat, and an attacker that died in
//    combat is no longer on any battlefield to scan — a scan would report "no
//    creatures attacked" exactly on the turns that saw the most combat. "No
//    creatures" is any player's creatures, which is what a game-level flag says
//    and a controller-scoped scan would not.
//
//  * "that they controlled since the beginning of the turn" — the new
//    `EffectCardFilter.controlledSinceTurnStart` clause, backed by
//    `hasControlledSinceTurnStart` (`gre/controlContinuity.ts`): the
//    `enteredOnTurn` entry stamp AND the turn-scoped
//    `GameState.controlChangedThisTurn` ledger together, so a creature that
//    entered this turn, one whose control changed this turn (in either
//    direction), and one that left and re-entered this turn are all excluded.
//    Strictly stronger than `enteredThisTurn: false`, which sees only zone
//    changes and would let a stolen creature through.
//
// The sacrifice is always the player's own explicit pick (`choice(kind:
// "sacrifice-permanents")` feeding `sacrifice`), never engine-auto-selected —
// the project-wide sacrifice-choice convention, and the shape Mana Vortex's
// each-upkeep land sacrifice (`drk/blue.ts`) already uses. With no legal
// creature the choice clamps to zero candidates and the ability does nothing
// (CR 608.2b); the trigger still goes on the stack under its full oracle text
// and visibly resolves, which is the engine's existing "nothing to choose"
// signal (same as Mana Vortex on a landless board) — there is no notify/log Op
// in the vocabulary to say more, and inventing one would be a stop-and-issue
// case, not an authoring liberty.
export const keldonTwilight: CardDefinition = {
    id: "e071665e-bb72-42e0-a42d-0d0ff02abd2b",
    rarity: "rare",
    name: "Keldon Twilight",
    oracleText:
        "At the beginning of each player's end step, if no creatures attacked this turn, that player sacrifices a creature of their choice that they controlled since the beginning of the turn.",
    manaCost: { X: 1, B: 1, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "keldon-twilight-end-step-sac",
            oracleText:
                "At the beginning of each player's end step, if no creatures attacked this turn, that player sacrifices a creature of their choice that they controlled since the beginning of the turn.",
            phase: "END_STEP",
            scope: "each",
            // CR 603.4 / 603.4d — checked at trigger time AND re-checked at
            // resolution by the factory.
            interveningIf: (_event, _self, state) =>
                state?.creatureAttackedThisTurn !== true,
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { ref: "$event.activePlayerId" },
                    zone: "battlefield",
                    filter: {
                        type: "Creature",
                        controlledSinceTurnStart: true,
                    },
                    count: 1,
                    prompt: "Keldon Twilight: sacrifice a creature you have controlled since the beginning of the turn.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        }),
    ],
};

// Phyrexian Tyranny — {U}{B}{R} Enchantment. "Whenever a player draws a
// card, that player loses 2 life unless they pay {2}." (issue #1946, parent
// PRD #1935, ADR 0079.)
//
// CR 117.3a — an "unless that player pays" clause is offered to the player
// the trigger IDENTIFIES, not to the enchantment's controller: here, whoever
// just drew. `drawTrigger({ scope: "each" })` fires on EITHER player's draw
// (CR 121.1), and the drawing player is read straight off the firing
// `CardDrawnEvent` via the newly-censused `{ ref: "$event.playerId" }`
// (`EVENT_FIELD_REGISTRY.CARD_DRAWN`, ADR 0049, mirroring
// `PHASE_BEGIN.activePlayerId` / issue #1066) — NOT the plain `"controller"`
// selector, which under `scope: "each"` would always resolve to Phyrexian
// Tyranny's own controller regardless of who drew.
//
// CR 120.3 — cards are drawn ONE AT A TIME. The engine's `emitCardDrawn`
// (`gre/state.ts`) already emits one `CARD_DRAWN` event per card, so a
// draw-three (or the draw-step draw) fires this ability once per card with
// no card-side work: `drawTrigger` / `emitCardDrawn` are shared choke points
// every draw already funnels through.
//
// The "unless they pay {2}" half reuses the existing `mayPay` (CR 117.3a /
// 118.4) + `if`/`loseLife` shape — the exact "unless you pay" punisher
// template Force Spike / Hasran Ogress already ship (`arn/black.ts`) — with
// the payer resolved to the drawing player instead of `"controller"`. No new
// Op, no new primitive: only the `player` ref differs from every prior
// mayPay card.
export const phyrexianTyranny: CardDefinition = {
    id: "e8440ca8-73ca-462b-a735-f6fb3d0de603",
    rarity: "rare",
    name: "Phyrexian Tyranny",
    oracleText:
        "Whenever a player draws a card, that player loses 2 life unless they pay {2}.",
    manaCost: { U: 1, B: 1, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        drawTrigger({
            id: "phyrexian-tyranny-unless-pay",
            oracleText:
                "Whenever a player draws a card, that player loses 2 life unless they pay {2}.",
            scope: "each",
            effects: [
                {
                    op: "mayPay",
                    player: { ref: "$event.playerId" },
                    cost: { X: 2 },
                    prompt: "Pay {2} or lose 2 life to Phyrexian Tyranny?",
                    bind: "$paid",
                },
                {
                    // CR 119.3b — unless paid, the drawing player loses 2
                    // life (not damage — no "damage prevention" interaction,
                    // no Fog).
                    op: "if",
                    predicate: { not: { binding: "$paid" } },
                    then: [
                        {
                            op: "loseLife",
                            player: { ref: "$event.playerId" },
                            amount: 2,
                        },
                    ],
                },
            ],
        }),
    ],
};
