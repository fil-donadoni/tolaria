// A TEMPORARY exile — an exiled card a delayed trigger will return to the
// battlefield (issue #6334).
//
// The "blink" idiom (issue #1401) is two Ops in one script: an `exile` that
// `bind`s the card it moves, then a `delayedTrigger` capturing that binding
// whose body `moveZone`s it back from exile to the battlefield (CR 603.7a —
// Flickerwisp, Liberate). Read Op by Op, the first is a removal and the second
// a recovery the leaf evaluator never sees: it reads the card in exile as gone
// for good, so flickering one's own permanent prices as losing it and exiling
// an opposing one as killing it.
//
// Both readers key on the SAME shape, never on a card:
//
//   * `blinkReturnedBindings` — the static read, for the per-slot beneficence
//     sign (`beneficence.ts`): which `exile` binds of a script come back.
//   * `pendingBattlefieldReturns` — the state read, for the evaluator
//     (`evaluate.ts`): which exiled cards a SCHEDULED delayed trigger returns,
//     and to which player.
//
// Fail closed in every clause, so an unread shape keeps today's price: only a
// phase-boundary timing (one that fires on the next such boundary whatever
// happens on the board), only a body-level `moveZone` (not one under an `if`
// or a `forEach`), only a card the payload names that still sits in exile.

import type { DelayedTriggerTiming, EffectOp } from "../../cards/types";
import { evaluateAttackerKeywords } from "../combatRegistry";
import { isCreature, isTapLockedBySummoningSickness } from "../constants";
import type { CardInstanceState, GameState } from "../state";
import type { Phase } from "../types";

/** The timings that fire at the next occurrence of a step or
 *  phase, unconditionally. Every other timing waits on a board event (a
 *  leave, a block, combat damage) that may never come. */
const PHASE_BOUNDARY_TIMINGS: ReadonlySet<DelayedTriggerTiming> = new Set([
    "next-end-step",
    "player-next-turn-end-step",
    "next-end-of-combat",
    "next-draw-step",
    "next-main-phase",
    "next-upkeep",
    "next-cleanup-step",
]);

/** A `moveZone` that names its object by `target` (not the zone-wide
 *  `cards` form). */
type ObjectMoveZoneOp = Extract<EffectOp, { op: "moveZone"; target: unknown }>;

/** The body-level `moveZone`s of `body` that put a BOUND card onto the
 *  battlefield from exile, keyed by the binding they read. */
function battlefieldReturnsIn(
    body: readonly EffectOp[]
): Map<string, ObjectMoveZoneOp> {
    const out = new Map<string, ObjectMoveZoneOp>();
    for (const op of body) {
        if (op.op !== "moveZone" || !("target" in op)) continue;
        if (op.to !== "battlefield") continue;
        const from = "from" in op ? op.from : undefined;
        if (from !== undefined && from !== "exile") continue;
        if (!("ref" in op.target)) continue;
        out.set(op.target.ref, op);
    }
    return out;
}

/** The `bind` names of `effects`' top-level `exile` Ops whose card a
 *  top-level phase-boundary `delayedTrigger` of the SAME script returns to
 *  the battlefield. */
export function blinkReturnedBindings(
    effects: readonly EffectOp[]
): Set<string> {
    const returned = new Set<string>();
    for (const op of effects) {
        if (op.op !== "delayedTrigger") continue;
        if (!PHASE_BOUNDARY_TIMINGS.has(op.timing)) continue;
        const returns = battlefieldReturnsIn(op.effects);
        for (const [bodyName, source] of Object.entries(op.capture ?? {})) {
            if (!returns.has(bodyName)) continue;
            if (typeof source !== "object" || !("ref" in source)) continue;
            returned.add(source.ref);
        }
    }
    const exiled = new Set<string>();
    for (const op of effects) {
        if (op.op === "exile" && op.bind && returned.has(op.bind)) {
            exiled.add(op.bind);
        }
    }
    return exiled;
}

/** One exiled card a scheduled delayed trigger returns to the battlefield,
 *  and the player it returns under. */
export type PendingReturn = {
    card: CardInstanceState;
    to: string;
    /** When the returning trigger fires (issue #7791 — whether the card is
     *  back before this turn's combat). */
    timing: DelayedTriggerTiming;
};

/** Every exiled card `state.delayedTriggers` will return to the battlefield.
 *  The recipient is the card's OWNER (a `moveZone` with no `controller` — the
 *  DSL's "under its owner's control") or the delayed trigger's controller
 *  (`controller: "controller"`; CR 603.7e — the player who controlled the
 *  ability that created it); any other recipient is not read. */
export function pendingBattlefieldReturns(state: GameState): PendingReturn[] {
    const out: PendingReturn[] = [];
    // Two triggers naming one card return it once.
    const seen = new Set<string>();
    for (const trigger of state.delayedTriggers ?? []) {
        if (!trigger.effects) continue;
        if (!PHASE_BOUNDARY_TIMINGS.has(trigger.timing)) continue;
        for (const [ref, op] of battlefieldReturnsIn(trigger.effects)) {
            // Payload keys are stored without the `$` sigil (Convex reserves
            // it), and re-bound with it at fire time.
            const id = trigger.payload[ref.slice(1)];
            if (typeof id !== "string") continue;
            for (const owner of state.players) {
                const card = owner.exile.find((c) => c.id === id);
                if (!card || seen.has(card.id)) continue;
                seen.add(card.id);
                const timing = trigger.timing;
                if (op.controller === undefined) {
                    out.push({ card, to: card.ownerId, timing });
                } else if (op.controller === "controller") {
                    out.push({ card, to: trigger.controller, timing });
                }
            }
        }
    }
    return out;
}

/** Issue #7791 — the timings whose return fires AFTER this turn's combat
 *  whenever that combat is still ahead: the end step (CR 513), the cleanup
 *  step (CR 514), the end of combat (CR 511) and a named player's next end
 *  step, which is never earlier than this turn's. `next-upkeep`,
 *  `next-draw-step` and `next-main-phase` can fire before the combat (an
 *  exile in the upkeep returning in the draw step) and are not read. */
const AFTER_COMBAT_RETURN_TIMINGS: ReadonlySet<DelayedTriggerTiming> = new Set([
    "next-end-step",
    "player-next-turn-end-step",
    "next-end-of-combat",
    "next-cleanup-step",
]);

/** The steps of a turn in which no attacker has been declared yet (CR 506.1,
 *  CR 508.1): its combat is still ahead. */
const BEFORE_ATTACKS: ReadonlySet<Phase> = new Set([
    "UNTAP",
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
]);

/** Issue #7791 — the BLOCKER a pending return keeps out of this turn's
 *  combat: a creature returning to a player who is not the active player
 *  (CR 506.2 — the defending player), after a combat that is still ahead, in
 *  which the active player controls a creature able to attack (untapped, not
 *  held by summoning sickness, CR 302.6, no keyword forbidding the attack).
 *  Such a creature is absent from the
 *  only declare-blockers step (CR 509.1) before it returns, so what the
 *  temporary exile took is exactly its block share for this turn — the
 *  quantity a "can't block" restriction prices (`creatureBlockShareRaw`,
 *  issue #5154). `false` in every other shape, fail closed:
 *
 *   * a creature returning to the ACTIVE player misses its attack only if it
 *     could have attacked, and the exiled instance no longer says so — its
 *     tap and summoning-sickness flags reset on the zone change (CR 400.7);
 *   * an opposing LAND exiled on this turn is instant-speed mana denied,
 *     which `flexibility` already reads off the untapped census. */
export function returnMissesBlocks(
    state: GameState,
    ret: PendingReturn
): boolean {
    if (!isCreature(ret.card)) return false;
    if (ret.to === state.activePlayerId) return false;
    if (!AFTER_COMBAT_RETURN_TIMINGS.has(ret.timing)) return false;
    if (!BEFORE_ATTACKS.has(state.phase)) return false;
    const active = state.players.find((p) => p.id === state.activePlayerId);
    return (
        active?.battlefield.some(
            (c) =>
                isCreature(c) &&
                !c.isTapped &&
                !isTapLockedBySummoningSickness(c) &&
                evaluateAttackerKeywords(c).eligible
        ) ?? false
    );
}

/** Issue #7791 — `state` with every card a pending return puts back on the
 *  battlefield standing there, under the player it returns under, untapped
 *  (a permanent enters untapped unless told otherwise, CR 110.5b), or
 *  `undefined` when nothing is pending. The board the turn's end restores,
 *  read by the evaluation where it looks past this turn: the material
 *  aggregates (the mana base, its development, its colour coverage) and the
 *  Danger Clock's race. A land or a blocker in temporary exile is not lost
 *  for good, and reading it so while its body is credited back priced
 *  Flickerwisp's exile of a Hill Giant as the opponent's curve and clock
 *  gone. Shallow, like `sweptAggregateNetLoss`'s "after" board
 *  (`evaluate.ts`). */
export function stateWithPendingReturns(
    state: GameState
): GameState | undefined {
    const returning = pendingBattlefieldReturns(state);
    if (returning.length === 0) return undefined;
    return {
        ...state,
        players: state.players.map((p) => {
            const mine = returning.filter((r) => r.to === p.id);
            if (mine.length === 0) return p;
            return {
                ...p,
                battlefield: [
                    ...p.battlefield,
                    ...mine.map((r) => ({
                        ...r.card,
                        controllerId: p.id,
                        isTapped: false,
                    })),
                ],
            };
        }),
    };
}
