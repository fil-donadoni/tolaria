// FIC — red cards, split by colour per ADR 0043. The registry's
// `import * as fic from "./sets/fic"` resolves through fic/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Gau, Feral Youth — {1}{R} Legendary Creature — Human Berserker, 2/2.
// "Rage — Whenever Gau attacks, put a +1/+1 counter on it.\nAt the beginning
// of each end step, if a card left your graveyard this turn, Gau deals damage
// equal to its power to each opponent."
//
// `Rage` is an ABILITY WORD (CR 207.2c — italic, ties similar cards together,
// no rules meaning and no Comprehensive Rules entry of its own). It gets NO
// Mechanics Registry row, exactly like Delirium, Domain and Metalcraft; the
// ability under it is a plain attack trigger.
//
// The second line is a CR 603.4 intervening-if over the per-turn "a card left
// your graveyard this turn" tally (`PlayerState.leftGraveyardThisTurn`, issue
// #3240), written at the shared `noteGraveyardDeparture` chokepoint on every
// graveyard exit — a flashback / escape / delve exile, reanimation, or any
// plain zone move off the graveyard (CR 400.7). "Each end step" means every
// player's, and there is exactly one end step per turn (CR 500.1 / 513.1), so
// each firing is in a different turn and reads that turn's own tally: the
// opponent's end step correctly sees zero unless something left YOUR graveyard
// during THEIR turn. Within the one end step, CR 603.4 checks the condition
// twice — when the trigger would fire and again as it resolves — which is why
// the tally is cleared only at the turn boundary.
//
// CR 120.1 — "each opponent" is the single opponent in this engine's
// two-player / solo-two-seat scope (3+ player multiplayer is out of scope).
//
// DIVERGENCE (tracked-by: #1417): "damage equal to its power" reads
// `{ ref: "$source.power" }`, which `resolveValue` resolves off the LIVE
// binding with no CR 608.2h last-known-information fallback. If Gau leaves the
// battlefield in response to the end-step trigger the ability deals 0 instead
// of its last known power. #1417 owns adding that fallback to the ref reader
// (the `counters` value member already has the shape to copy); the same gap is
// documented on Tahngarth, Talruum Hero (`pls/red.ts`).
//
// compiler-gap: "At the beginning of each end step, if a card left your graveyard this turn, Gau deals damage equal to its power to each opponent." (#2693)
export const gauFeralYouth: CardDefinition = {
    id: "89175ce1-0746-4ba1-970e-617d134b0527",
    rarity: "rare",
    name: "Gau, Feral Youth",
    oracleText:
        "Rage — Whenever Gau attacks, put a +1/+1 counter on it.\nAt the beginning of each end step, if a card left your graveyard this turn, Gau deals damage equal to its power to each opponent.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Berserker"],
    supertypes: ["Legendary"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        attacksTrigger({
            id: "gau-feral-youth-rage",
            oracleText: "Whenever Gau attacks, put a +1/+1 counter on it.",
            scope: "self",
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
        phaseTrigger({
            id: "gau-feral-youth-end-step",
            oracleText:
                "At the beginning of each end step, if a card left your graveyard this turn, Gau deals damage equal to its power to each opponent.",
            phase: "END_STEP",
            scope: "each",
            // CR 603.4 — "your graveyard" is the SOURCE's controller's, not the
            // player whose end step it is: the condition reads the same tally
            // at both end steps of the turn.
            interveningIf: (_event, self, state) =>
                (state?.players.find((p) => p.id === self.controllerId)
                    ?.leftGraveyardThisTurn ?? 0) > 0,
            effects: [
                {
                    op: "dealDamage",
                    // CR 613 — EFFECTIVE power at resolution, counters and
                    // pumps included, so a Rage counter added this turn or
                    // removal in response changes the number.
                    amount: { ref: "$source.power" },
                    to: { player: "opponent" },
                },
            ],
        }),
    ],
};

export {};
