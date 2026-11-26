// A delayed "pay or lose the game" obligation the payer cannot meet (issue
// #10818).
//
// THE SHAPE. A spell or ability may leave a delayed triggered ability behind
// (CR 603.7a) whose script is "pay {cost}. If you don't, you lose the game" —
// a `mayPay` Op of the controller followed by an `if` whose unpaid arm is a
// `loseGame` of the controller (CR 104.3e: an effect may state that a player
// loses the game). The Pact cycle is the catalogue's shape: Summoner's Pact
// queues "At the beginning of your next upkeep, pay {2}{G}{G}. If you don't,
// you lose the game." as an inline delayed body.
//
// WHY THE EVALUATION READS IT. Between the resolution that queues the
// obligation and the upkeep that fires it, the position looks like any other:
// the tutor's find is in hand and nothing has been lost. A leaf scored there —
// the rollout policy's one-ply probe, which resolves the cast it probes, and a
// rollout cut by its horizon before the upkeep — read the cast as a free
// tutor, so both the tree and the rollouts below `pass` walked into a loss
// they could not see. When the payer's sources cannot pay the cost even all
// untapped, the obligation IS the loss, one trigger before the engine records
// it, exactly as an empty library is a loss one draw before the SBA
// (`deckOutDelta`).
//
// CONSERVATIVE, it under-reports rather than over-fires:
//   * only an UPKEEP obligation of the payer's own upkeep (`next-upkeep` /
//     `each-own-upkeep` scoped to the controller): the untap step precedes it
//     (CR 502.3), so every source the payer controls is read untapped, and
//     the mana pool, which empties between steps (CR 500.5), is read empty.
//     Any other timing fails open — a land drop or an untap could fall
//     between now and the trigger;
//   * with the payer the ACTIVE player and a land in hand, the land drop
//     still open this turn could add a source: it fails open;
//   * only a mana-only cost — a life or permanent leg is not read here;
//   * a source that would not untap (an untap lock) is still read untapped,
//     which only ever makes the cost look MORE payable.
//
// Fix the class: the obligation is read from the Effect Script (the delayed
// body inline on the instance, else its template's script), payability from
// the payer's own mana sources through the planner the search pays with
// (`planManaPayment`). No card name, no per-card table (ADR 0102).

import type { EffectOp, MayPayCost } from "../../cards/types";
import { tryGetDefinition } from "../../cards";
import { isLand } from "../constants";
import { planManaPayment } from "../moves";
import {
    normalizeManaCost,
    normalizeMayPayCost,
    type DelayedTriggerInstance,
    type GameState,
    type PlayerState,
} from "../state";
import { unpaidArmLosesGame } from "./searchDestination";

/** The script a delayed trigger will run when it fires: its ADR 0048 inline
 *  body, else its template's on the source definition. */
function delayedScript(
    trigger: DelayedTriggerInstance
): readonly EffectOp[] | undefined {
    if (trigger.effects) return trigger.effects;
    return tryGetDefinition(trigger.sourceCardId)?.delayedTriggers?.find(
        (t) => t.id === trigger.triggerId
    )?.effects;
}

/** The mana cost of the controller's `mayPay` whose unpaid arm loses the
 *  game, or `undefined` when `script` is not that shape or its cost carries
 *  a non-mana leg. */
function lossObligationManaCost(
    script: readonly EffectOp[]
): Record<string, number> | undefined {
    for (let i = 0; i < script.length; i++) {
        const op = script[i] as {
            op: string;
            player?: unknown;
            bind?: unknown;
            cost?: MayPayCost;
        };
        if (op.op !== "mayPay" || op.player !== "controller") continue;
        if (typeof op.bind !== "string" || !op.cost) continue;
        if (!unpaidArmLosesGame(script, op.bind)) continue;
        const { mana, ...otherLegs } = normalizeMayPayCost(op.cost);
        if (!mana || Object.keys(otherLegs).length > 0) return undefined;
        return normalizeManaCost(mana);
    }
    return undefined;
}

/** `player` at their next upkeep: every permanent untapped (CR 502.3), the
 *  pool empty (CR 500.5). */
function atOwnUpkeep(
    state: GameState,
    player: PlayerState
): { state: GameState; player: PlayerState } {
    const untapped: PlayerState = {
        ...player,
        manaPool: {},
        restrictedMana: undefined,
        battlefield: player.battlefield.map((c) =>
            c.isTapped ? { ...c, isTapped: false } : c
        ),
    };
    return {
        state: {
            ...state,
            players: state.players.map((p) =>
                p.id === player.id ? untapped : p
            ),
        },
        player: untapped,
    };
}

const UPKEEP_TIMINGS: ReadonlySet<string> = new Set([
    "next-upkeep",
    "each-own-upkeep",
]);

/** Whether `playerId` holds delayed pay-or-lose obligations at their own
 *  next upkeep that their mana sources cannot pay (CR 603.7a, 104.3e) — the
 *  game is lost at that trigger. Every such obligation fires at the same
 *  upkeep and each must be paid, so their costs are paid as ONE sum. Fails
 *  open (`false`) on anything it cannot read soundly; see the module header.
 *  Pure. */
export function holdsUnpayableLossObligation(
    state: GameState,
    playerId: string
): boolean {
    const triggers = state.delayedTriggers;
    if (!triggers || triggers.length === 0) return false;
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return false;
    if (state.activePlayerId === playerId && player.hand.some(isLand)) {
        return false;
    }
    let owed: Record<string, number> | undefined;
    for (let i = 0; i < triggers.length; i++) {
        const t = triggers[i];
        if (t.controller !== playerId || t.targetPlayerId !== playerId) {
            continue;
        }
        if (!UPKEEP_TIMINGS.has(t.timing)) continue;
        const script = delayedScript(t);
        if (!script) continue;
        const cost = lossObligationManaCost(script);
        if (!cost) continue;
        const sum: Record<string, number> = (owed ??= {});
        const symbols = Object.keys(cost);
        for (let j = 0; j < symbols.length; j++) {
            const symbol = symbols[j];
            sum[symbol] = (sum[symbol] ?? 0) + cost[symbol];
        }
    }
    if (!owed) return false;
    const upkeep = atOwnUpkeep(state, player);
    return planManaPayment(upkeep.state, upkeep.player, owed) === null;
}
