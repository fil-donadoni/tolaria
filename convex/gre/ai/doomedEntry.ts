// A DOOMED ENTRY — a body a script puts onto the battlefield and removes again
// before it could fight (CR 603.7a).
//
// The cheat-into-play idiom is one script: a `moveZone` onto the battlefield
// that binds what it moved, then a `delayedTrigger` capturing that binding whose
// body sacrifices it at the next end step (Sneak Attack, Through the Breach).
// Its whole worth is the combat it reaches, so whether the move is worth anything
// depends on the window it is made in, and this reads that window.
//
// Fail closed in every clause, so an unread shape stays a scored option: only a
// phase-boundary timing, only a body-level `sacrifice` / `destroy` / `exile` of a
// captured binding (not one under an `if` or a `forEach`, and not an `exile` that
// binds its card, which is how a body says it brings it back).
//
// The same departure, read off a body already on the battlefield, is what the
// evaluation discounts (`scheduledEndStepDeparture`): such a body is worth only
// what it does before it goes.

import type {
    DelayedTriggerTiming,
    EffectOp,
    TriggeredAbility,
} from "../../cards/types";
import { evaluateAttackerKeywords } from "../combatRegistry";
import { isCreature, isTapLockedBySummoningSickness } from "../constants";
import { effectiveTriggeredAbilities } from "../copy";
import type {
    CardInstanceState,
    DelayedTriggerInstance,
    GameState,
} from "../state";
import type { Phase } from "../types";

/** The timings that fire at the next occurrence of a step, unconditionally,
 *  and that this read can place against a combat. */
const DEPARTURE_TIMINGS: ReadonlySet<DelayedTriggerTiming> = new Set([
    "next-end-step",
    "next-cleanup-step",
    "next-end-of-combat",
    "next-upkeep",
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

/** The combat steps past the declaration of attackers (CR 508.1): a body that
 *  enters in one neither attacks nor blocks (CR 509.1a) in this combat. */
const COMBAT_PAST_ATTACKS: ReadonlySet<Phase> = new Set([
    "DECLARE_BLOCKERS",
    "FIRST_STRIKE_DAMAGE",
    "COMBAT_DAMAGE",
]);

/** The binding names `body` removes from the battlefield at its top level. */
function departingRefsIn(body: readonly EffectOp[]): string[] {
    const refs: string[] = [];
    for (const op of body) {
        if (
            op.op !== "sacrifice" &&
            op.op !== "destroy" &&
            !(op.op === "exile" && !op.bind)
        ) {
            continue;
        }
        const target = op.target;
        if (target && typeof target === "object" && "ref" in target) {
            refs.push(target.ref);
        }
    }
    return refs;
}

/** Whether the turn after this one holds a combat a body could fight in: its
 *  controller's attack, or a block against a creature already on the board that
 *  could attack then (2-player, no extra turn read). */
function fightsNextTurn(state: GameState, controllerId: string): boolean {
    if (controllerId !== state.activePlayerId) return true;
    return state.players.some(
        (p) =>
            p.id !== controllerId &&
            p.battlefield.some(
                (c) => isCreature(c) && evaluateAttackerKeywords(c).eligible
            )
    );
}

/** Whether this turn's combat, still ahead, is one a body could fight in: its
 *  controller's attack (CR 508.1a), or a block against a creature the active
 *  player could attack with (CR 509.1a). */
function fightsThisTurn(state: GameState, controllerId: string): boolean {
    if (controllerId === state.activePlayerId) return true;
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

/** Whether a body entering now, in the declare-attackers step, is a defender
 *  with an attack declared to block (CR 509.1a). An attacker's own controller has
 *  already declared: the body is too late for it (CR 508.1a). */
function blocksDeclaredAttack(state: GameState, controllerId: string): boolean {
    return (
        controllerId !== state.activePlayerId &&
        !!state.combat?.confirmed &&
        state.combat.attackerIds.length > 0
    );
}

/** Whether a body entering now under `controllerId` sees a combat before a
 *  `timing` trigger removes it. A delayed trigger fires only the NEXT time its
 *  event occurs (CR 603.7b), and the engine fires each timing on entering its
 *  step, so one created in or past its step waits for the following turn's: that
 *  is what makes an activation in an end step last through the next turn. */
export function fightsBeforeDeparture(
    state: GameState,
    controllerId: string,
    timing: DelayedTriggerTiming
): boolean {
    if (COMBAT_PAST_ATTACKS.has(state.phase)) return false;
    if (state.phase === "DECLARE_ATTACKERS") {
        return blocksDeclaredAttack(state, controllerId);
    }
    if (BEFORE_ATTACKS.has(state.phase)) {
        return fightsThisTurn(state, controllerId);
    }
    if (timing === "next-upkeep") return false;
    if (timing === "next-end-of-combat") {
        return fightsNextTurn(state, controllerId);
    }
    if (timing === "next-end-step") {
        return (
            (state.phase === "END_STEP" || state.phase === "CLEANUP") &&
            fightsNextTurn(state, controllerId)
        );
    }
    return state.phase === "CLEANUP" && fightsNextTurn(state, controllerId);
}

const ENTRY_DEPARTURE_MEMO = new WeakMap<
    readonly EffectOp[],
    DelayedTriggerTiming | null
>();

/** The timing of the delayed trigger in `effects` that removes the very body
 *  `effects` put onto the battlefield (a `moveZone` binding it, a `delayedTrigger`
 *  capturing that binding), or `undefined` for any other script. A script is
 *  data, so this is read once per script. */
export function enteringBodyDepartureTiming(
    effects: readonly EffectOp[]
): DelayedTriggerTiming | undefined {
    const memo = ENTRY_DEPARTURE_MEMO.get(effects);
    if (memo !== undefined) return memo ?? undefined;
    const entered = new Set<string>();
    for (const op of effects) {
        if (op.op === "moveZone" && op.to === "battlefield" && op.bind) {
            entered.add(op.bind);
        }
    }
    let timing: DelayedTriggerTiming | null = null;
    for (const op of effects) {
        if (op.op !== "delayedTrigger") continue;
        if (!DEPARTURE_TIMINGS.has(op.timing)) continue;
        const removes = departingRefsIn(op.effects).some((ref) => {
            const source = op.capture?.[ref];
            return (
                typeof source === "object" &&
                "ref" in source &&
                entered.has(source.ref)
            );
        });
        if (removes) timing = op.timing;
    }
    ENTRY_DEPARTURE_MEMO.set(effects, timing);
    return timing ?? undefined;
}

/** When a body on the battlefield is scheduled to leave at an end step: at
 *  this turn's, or at a later turn's (this turn's end step has begun, or the
 *  trigger fires only on its controller's end step and this is not that
 *  player's turn). */
export type EndStepDeparture = "this-turn" | "later";

/** The steps at or past the end step: a trigger at the beginning of the end
 *  step (CR 513.1a) has already had its chance this turn. */
const AT_OR_PAST_END_STEP: ReadonlySet<Phase> = new Set([
    "END_STEP",
    "CLEANUP",
]);

const SELF_DEPARTURE_MEMO = new WeakMap<TriggeredAbility, boolean>();

/** Whether `ability` is a card's own unconditional "at the beginning of the
 *  end step, sacrifice this" (CR 513.1a): a phase trigger on the end step whose
 *  script removes its own source at the top level. A gated or intervening-if
 *  trigger, a scope this read cannot place, and a closure body all read as
 *  no departure. */
function isSelfEndStepDeparture(ability: TriggeredAbility): boolean {
    const memo = SELF_DEPARTURE_MEMO.get(ability);
    if (memo !== undefined) return memo;
    const departs =
        ability.event === "PHASE_BEGIN" &&
        ability.phaseStep === "END_STEP" &&
        (ability.phaseScope === "each" || ability.phaseScope === "your") &&
        !ability.gate &&
        !ability.interveningIf &&
        !ability.sourceTapCondition &&
        !!ability.effects &&
        departingRefsIn(ability.effects).includes("$source");
    SELF_DEPARTURE_MEMO.set(ability, departs);
    return departs;
}

/** The steps a delayed trigger of `timing` has already had its chance in this
 *  turn: the engine fires it on entering its step (CR 603.7b), so an instance
 *  still scheduled there fires at a later turn's. Undefined for a timing this
 *  read does not place. */
const DELAYED_DEPARTURE_PASSED: Partial<
    Record<DelayedTriggerTiming, ReadonlySet<Phase>>
> = {
    "next-end-step": AT_OR_PAST_END_STEP,
    "next-cleanup-step": new Set<Phase>(["CLEANUP"]),
};

/** Whether the scheduled delayed trigger `trigger` removes `body` when it
 *  fires: an inline body sacrificing, destroying or exiling a captured binding
 *  holding `body` at its top level (CR 603.7a), or a warp exile of the
 *  permanent the warp spell became (CR 702.185a), which is still that object
 *  only while it carries the warp marker (CR 400.7). */
function delayedTriggerRemoves(
    trigger: DelayedTriggerInstance,
    body: CardInstanceState
): boolean {
    if (trigger.warpCardInstanceId !== undefined) {
        return trigger.warpCardInstanceId === body.id && !!body.warped;
    }
    if (!trigger.effects) return false;
    return departingRefsIn(trigger.effects).some((ref) => {
        // The payload stores a binding without its `$` sigil
        // (`runDelayedTriggerBody` re-adds it at fire time).
        const captured = trigger.payload[ref.slice(1)] ?? trigger.payload[ref];
        return Array.isArray(captured)
            ? captured.includes(body.id)
            : captured === body.id;
    });
}

/** When a scheduled delayed trigger removes `body` at an end step or a
 *  cleanup step (Sneak Attack, a Kiki-Jiki token, a warped permanent), or
 *  `undefined` when none does. One scoped to a player (`targetPlayerId`) waits
 *  for that player's turn: its event occurs only then (CR 603.7b). */
function delayedEndStepDeparture(
    state: GameState,
    body: CardInstanceState
): EndStepDeparture | undefined {
    let departure: EndStepDeparture | undefined;
    for (const trigger of state.delayedTriggers ?? []) {
        const passed = DELAYED_DEPARTURE_PASSED[trigger.timing];
        if (!passed || !delayedTriggerRemoves(trigger, body)) continue;
        const thisTurn =
            !passed.has(state.phase) &&
            (trigger.targetPlayerId === undefined ||
                trigger.targetPlayerId === state.activePlayerId);
        if (thisTurn) return "this-turn";
        departure = "later";
    }
    return departure;
}

/** When `body` leaves at an end step: through its own end-step trigger
 *  removing itself (Ball Lightning), or through a scheduled delayed trigger
 *  removing it (CR 603.7a: Sneak Attack, a Kiki-Jiki token, a warp exile), or
 *  `undefined` for a body nothing removes there. Its own trigger is read off
 *  the abilities it has now, so one it lost (CR 613.1f) is no departure; a
 *  trigger already fired is a stack item and is not read. */
export function scheduledEndStepDeparture(
    state: GameState,
    body: CardInstanceState
): EndStepDeparture | undefined {
    let departure = delayedEndStepDeparture(state, body);
    if (departure === "this-turn") return departure;
    const atOrPastEnd = AT_OR_PAST_END_STEP.has(state.phase);
    for (const ability of effectiveTriggeredAbilities(body)) {
        if (!isSelfEndStepDeparture(ability)) continue;
        const ownStep =
            ability.phaseScope === "each" ||
            body.controllerId === state.activePlayerId;
        if (ownStep && !atOrPastEnd) return "this-turn";
        departure = "later";
    }
    return departure;
}
