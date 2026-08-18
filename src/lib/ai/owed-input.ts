// Bot liveness: owed-ness comes from the ENGINE (ADR 0047), never from a
// parallel derivation (issue #2284).
//
// The bot used to decide what it owed by walking the individual waiting fields
// itself — `pendingChoices`, `pendingTarget`, the payment parks, the combat
// declarations, `priorityPlayerId` — each guarded by its own
// `=== view.botId` check. The engine already collapses all of them into ONE
// authoritative answer, the Expected Input (`computeExpectedInput` /
// `computeOwedPlayerIds`, ADR 0047), maintained at every stable point and
// exhaustive over its kind union at compile time. Two independently-derived
// answers to "is the game waiting on the bot?" can disagree, and when they did
// the game stopped forever: the engine said "waiting on the bot", the bot said
// "nothing owed", and nothing else in the loop could tell that apart from a
// correct idle.
//
// This module is the single consumption point of that authority for the bot:
//
//  * {@link owedInputFor} answers "is the game waiting on this seat, and for
//    what kind of input" by CALLING the engine's own two functions. It derives
//    nothing.
//  * {@link ESCALATION_POLICY} classifies every Expected Input kind by the way
//    OUT the Comprehensive Rules provide for that window — compile-time
//    exhaustive (`satisfies` + the `Exclude`-to-never witness), mirroring
//    `convex/gre/pendingTargetOrigin.ts`, so a new waiting kind cannot be added
//    without the bot being forced to classify it.
//  * {@link escalationLadder} turns that classification into the deterministic,
//    always-legal sequence of actions the driver's watchdog walks when the
//    normal decision path produces nothing.
//
// Every rung is a LEGAL answer routed through an existing mutation — the
// decline the CR already defines for that window (CR 608.2b: a mandatory target
// nobody chooses removes the ability from the stack; an "up to" target resolves
// with none; an empty blocker declaration; a declined optional payment) — never
// an invented skip and never a state mutation outside the mutation surface.

import {
    computeExpectedInput,
    computeOwedPlayerIds,
    type ExpectedInputKind,
} from "@convex/gre/expectedInput";
import type { GameState } from "@convex/gre/state";
import type { BotAction, BotView } from "./brain";
import {
    chooseMulliganBottoms,
    chooseOwedChoiceAction,
    chooseOwedTargetAction,
    decidePriorityAction,
} from "./brain";

/** What the engine says this seat is being waited on for (ADR 0047). A thin
 *  record over {@link computeExpectedInput}'s answer — deliberately NOT a new
 *  shape the bot maintains itself. */
export type OwedInput = {
    /** The Expected Input kind the game is currently resting on. */
    kind: ExpectedInputKind;
    /** The acting player the Expected Input names. Equals the queried seat for
     *  every kind EXCEPT the CR 510.1c/702.22j-k combat-damage-assignment
     *  sub-flow, which folds into a `priority` window whose real actors live in
     *  `combat.damageAssignerIds` — which is exactly why owed-ness is decided by
     *  MEMBERSHIP in `computeOwedPlayerIds`, never by equality with this id. */
    playerId: string;
};

/** THE answer to "is the game waiting on `playerId`, and for what?" — the
 *  engine's, consumed. Returns `undefined` when the game is not waiting on this
 *  seat at all (including a finished game, CR 104).
 *
 *  Both engine functions are called: `computeOwedPlayerIds` decides owed-NESS
 *  (it folds in the multi-assigner combat-damage sub-flow that a single
 *  `expectedInput.playerId` misses) and `computeExpectedInput` names the KIND. */
export function owedInputFor(
    state: GameState,
    playerId: string
): OwedInput | undefined {
    if (!computeOwedPlayerIds(state).includes(playerId)) return undefined;
    const expected = computeExpectedInput(state);
    if (!expected) return undefined;
    return { kind: expected.kind, playerId: expected.playerId };
}

/** The engine path that legally ABANDONS a waiting window, when the rules
 *  provide one. Each value names an existing mutation, dispatched by
 *  `submitDeclineAction` (`src/lib/ai/decline.ts`):
 *
 *   - `"cancel-target"`       → `cancelTarget`. CR 608.2b — a mandatory target
 *     nobody chooses removes the ability from the stack; an "up to" selection
 *     resolves with no target; an announced cast's selection rewinds the
 *     announcement (CR 601.2). One mutation, all three cases, engine-side.
 *   - `"confirm-no-blockers"` → `confirmBlockers` with nothing selected.
 *     CR 509.1 — declaring no blockers is always a legal declaration.
 *   - `"cancel-attack-tax"`   → `cancelAttackTax`. CR 508.1c/1g — declining the
 *     optional per-attacker tax drops the attack declaration.
 *   - `"abort-announcement"`  → `cancelCast` / `cancelActivation`. CR 601.2h —
 *     an announcement whose costs are not paid is rewound.
 *   - `null`                  — the CR provides no decline for this window; the
 *     minimal-legal answer (rung 2) IS the only way out. */
export type DeclinePath =
    | "cancel-target"
    | "confirm-no-blockers"
    | "cancel-attack-tax"
    | "abort-announcement";

export type EscalationPolicy = {
    /** The CR-provided decline for this window (rung 3), or `null` when none
     *  exists and the minimal-legal answer is the only legal exit. */
    decline: DeclinePath | null;
    /** Whether a bare priority pass (CR 117.3) is a legal way out of this
     *  window (rung 4). Only the `priority` window ever is: every other kind is
     *  a turn-based action or a suspended resolution, where `passPriority` is
     *  rejected by the Expected Input gate itself. */
    canPass: boolean;
};

/** How each Expected Input kind can be legally abandoned (issue #2284).
 *
 *  `satisfies Record<ExpectedInputKind, …>` plus the `Exclude`-to-never witness
 *  below make this exhaustive in BOTH directions: a stray key is rejected, and
 *  a NEW kind added to the engine's union fails to compile here until it is
 *  classified. That is the structural guarantee the issue asks for — the bot
 *  cannot silently inherit a waiting state nobody taught it to leave. */
export const ESCALATION_POLICY = {
    // CR 608.2 — a mid-resolution choice is MADE as part of resolution; the
    // rules provide no way to decline one, so the minimal-legal submission
    // (rung 2) is the exit. Passing is rejected while a choice is pending.
    //
    // THE CONTRACT THAT BUYS (issue #2497): because there is nothing below
    // rung 2 here, rung 2 for `choice` must be legal BY CONSTRUCTION — each
    // branch of `chooseOwedChoiceAction` computes its answer through the very
    // engine authority the server re-validates it with, and returns `none`
    // (dropping the rung) rather than a guess when no legal answer exists. A
    // server-side check that can reject rung 2 does not make the bot retry; it
    // freezes the game, because the rejected mutation leaves the state
    // unchanged and the ladder is deterministic, so the next walk — automatic
    // or the human's `resolveStuck` click — recomputes the identical rejected
    // submission. `name-card` is where that bit: its default was picked with a
    // bare registry-existence check while `applyNameCardSubmit` also enforces
    // CR 201.3's `no-basic-land` restriction and an as-enters `filter`.
    choice: { decline: null, canPass: false },
    target: { decline: "cancel-target", canPass: false },
    blockers: { decline: "confirm-no-blockers", canPass: false },
    // CR 508.1g — the attack-declaration land-sacrifice tax is mandatory once
    // the attack is declared and has no cancel mutation; the minimal-legal
    // victim pick (rung 2) is the exit.
    sacrifice: { decline: null, canPass: false },
    "attack-mana-tax": { decline: "cancel-attack-tax", canPass: false },
    priority: { decline: "abort-announcement", canPass: true },
} as const satisfies Record<ExpectedInputKind, EscalationPolicy>;

/** Compile-time witness that {@link ESCALATION_POLICY} covers every member of
 *  `ExpectedInputKind`. Adding a variant to the engine's union without adding
 *  it here makes the conditional resolve to `never`, and assigning `true` to it
 *  errors — the same shape `EXPECTED_INPUT_KINDS` and `PENDING_TARGET_ORIGIN`
 *  already use. */
type MissingEscalationPolicy = Exclude<
    ExpectedInputKind,
    keyof typeof ESCALATION_POLICY
>;
const _escalationPolicyExhaustive: [MissingEscalationPolicy] extends [never]
    ? true
    : never = true;
void _escalationPolicyExhaustive;

/** A rung of the escalation ladder (issue #2284). Rung 1 — re-running the
 *  normal decision path once, to absorb a stale view or a transient worker
 *  failure — is the DRIVER's, not a step here, because it is the ordinary path
 *  rather than a fallback. */
export type EscalationRung = 2 | 3 | 4;

export type EscalationStep = {
    rung: EscalationRung;
    action: BotAction;
};

/** The deterministic escalation ladder for a window the bot is owed but has not
 *  answered (issue #2284), in order:
 *
 *   2. the minimal-legal answer for that Expected Input kind — the existing
 *      ADR 0016 conservative-default policy, generalized from pending choices
 *      to every kind;
 *   3. the engine's own decline/abort path where the rules provide one
 *      ({@link ESCALATION_POLICY});
 *   4. a priority pass where passing is legal.
 *
 *  Beyond the last step the driver surfaces a user-visible, actionable state
 *  (rung 5) — never a silent no-op.
 *
 *  Every step is computed from the VIEW and the engine authorities, NOT from
 *  `decideBotAction`: the ladder's whole job is to be an answer when the
 *  decision path has none. The switch is compile-time exhaustive over the
 *  Expected Input kind union. */
export function escalationLadder(
    kind: ExpectedInputKind,
    view: BotView
): EscalationStep[] {
    const steps: EscalationStep[] = [];
    const push = (rung: EscalationRung, action: BotAction | null) => {
        if (action && action.kind !== "none" && action.kind !== "unanswered") {
            steps.push({ rung, action });
        }
    };

    switch (kind) {
        case "choice":
            // The pre-game bottoming choice (CR 103.5) rides `pendingChoices`
            // like every other, but its answer comes from the mulligan hand
            // heuristic rather than the ADR 0016 zone-pick policy.
            if (view.mulliganBottomCount !== undefined) {
                push(2, {
                    kind: "mulligan-bottom",
                    cardInstanceIds: chooseMulliganBottoms(
                        view.mulliganHand ?? [],
                        view.mulliganBottomCount
                    ),
                });
            } else if (view.owedChoice) {
                push(2, chooseOwedChoiceAction(view.owedChoice));
            }
            break;

        case "target":
            // Rung 2 exists only for an ENGINE-RAISED selection, where
            // `buildOwedTargetView` precomputed a minimal-legal submission
            // through the same enumerator the search reads. An ANNOUNCED
            // selection (the bot's own half-built cast) has no conservative
            // answer — the executor drives it atomically — so it escalates
            // straight to the rewind at rung 3.
            push(
                2,
                view.owedTarget ? chooseOwedTargetAction(view.owedTarget) : null
            );
            break;

        case "blockers":
            // CR 509.1 — the conservative default and the decline coincide:
            // declaring no blockers is both the minimal-legal answer and the
            // way to abandon the window, so it is offered once, at rung 2.
            push(2, { kind: "confirm-no-blockers" });
            break;

        case "sacrifice":
            push(
                2,
                view.attackSacrifice
                    ? {
                          kind: "select-sacrifice",
                          cardInstanceIds: view.attackSacrifice.cardInstanceIds,
                      }
                    : null
            );
            break;

        case "attack-mana-tax":
            push(
                2,
                view.attackManaTaxAffordable
                    ? { kind: "pay-attack-tax" }
                    : { kind: "cancel-attack-tax" }
            );
            break;

        case "priority":
            // The existing conservative-default policy for a priority window:
            // the payment parks, the mulligan declaration, the combat-damage
            // confirmation and the combat declarations.
            push(2, withoutSearch(decidePriorityAction(view)));
            break;

        default:
            return assertNeverKind(kind);
    }

    const policy = ESCALATION_POLICY[kind];
    if (policy.decline) push(3, declineAction(policy.decline, view));
    if (policy.canPass) push(4, { kind: "pass" });

    return steps;
}

/** Strip a SEARCH-realised answer out of the ladder (issue #2284). The ladder
 *  exists precisely because the normal path — which includes the Worker search —
 *  produced nothing, so handing a window back to the Worker is not an
 *  escalation. The two combat declarations degrade to their empty declaration
 *  (CR 508.1 / 509.1 — declaring no attackers / no blockers is always legal);
 *  `pass` is dropped because rung 4 realises it directly through `passPriority`;
 *  everything else is already a direct submission. */
function withoutSearch(action: BotAction): BotAction | null {
    switch (action.kind) {
        case "declare-attackers":
            return { kind: "confirm-no-attackers" };
        case "declare-blockers":
            return { kind: "confirm-no-blockers" };
        case "search-choice":
        case "search-target":
        case "pass":
            return null;
        default:
            return action;
    }
}

/** The concrete {@link BotAction} for a {@link DeclinePath}. `abort-announcement`
 *  needs to know WHICH container is parked; when neither is, there is nothing to
 *  abort and the rung is skipped (rung 4's pass covers a plain priority
 *  window). */
function declineAction(path: DeclinePath, view: BotView): BotAction | null {
    switch (path) {
        case "cancel-target":
            return { kind: "cancel-target" };
        case "confirm-no-blockers":
            // Already offered at rung 2 for the `blockers` kind — never reached
            // there, and kept total for any future kind that maps to it.
            return { kind: "confirm-no-blockers" };
        case "cancel-attack-tax":
            return { kind: "cancel-attack-tax" };
        case "abort-announcement":
            return view.parkedAnnouncement
                ? {
                      kind: "abort-announcement",
                      container: view.parkedAnnouncement,
                  }
                : null;
        default:
            return assertNeverDecline(path);
    }
}

function assertNeverKind(x: never): never {
    throw new Error(`Unhandled ExpectedInputKind: ${String(x)}`);
}

function assertNeverDecline(x: never): never {
    throw new Error(`Unhandled DeclinePath: ${String(x)}`);
}
