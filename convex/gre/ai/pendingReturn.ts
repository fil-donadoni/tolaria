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
import type { CardInstanceState, GameState } from "../state";

/** CR 603.7 — the timings that fire at the next occurrence of a step or
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

type MoveZoneOp = Extract<EffectOp, { op: "moveZone" }>;

/** The body-level `moveZone`s of `body` that put a BOUND card onto the
 *  battlefield from exile, keyed by the binding they read. */
function battlefieldReturnsIn(
    body: readonly EffectOp[]
): Map<string, MoveZoneOp> {
    const out = new Map<string, MoveZoneOp>();
    for (const op of body) {
        if (op.op !== "moveZone" || op.to !== "battlefield") continue;
        if (op.from !== undefined && op.from !== "exile") continue;
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
export type PendingReturn = { card: CardInstanceState; to: string };

/** Every exiled card `state.delayedTriggers` will return to the battlefield.
 *  The recipient is the card's OWNER (a `moveZone` with no `controller`, CR
 *  110.2 "under its owner's control") or the trigger's controller (CR 113.7,
 *  `controller: "controller"`); any other recipient is not read. */
export function pendingBattlefieldReturns(state: GameState): PendingReturn[] {
    const out: PendingReturn[] = [];
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
                if (!card) continue;
                if (op.controller === undefined) {
                    out.push({ card, to: card.ownerId });
                } else if (op.controller === "controller") {
                    out.push({ card, to: trigger.controller });
                }
            }
        }
    }
    return out;
}
