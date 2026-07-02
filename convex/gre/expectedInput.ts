// Authoritative Expected Input (ADR 0047).
//
// The engine's waiting-state machine is factored across independent fields
// (`pendingCast` / `pendingActivation` / `pendingTarget` / `pendingChoices` /
// combat blocker declaration / priority). This module collapses that into one
// authoritative answer to "what is the game waiting for, from whom?" — the
// `expectedInput` field on GameState — MAINTAINED at every stable point rather
// than derived on read.
//
// Scope (issue #796): this slice introduced the field + its bookkeeping and a
// runtime coherence invariant.
//
// Scope (issue #799): `assertExpectedInput` below is the SINGLE gate every game
// mutation routes through before its action-specific validation. "Is this the
// right moment, from the right player, for this kind of input?" now lives in
// exactly one place (ADR 0047) instead of being re-derived in ~15 mutations.

import type { ExpectedInput, GameState } from "./state";
import { getOpponentId } from "./state";

/** Pure, total derivation of the Expected Input from a settled GameState
 *  (ADR 0047). Precedence — highest first — reflects the CR's nesting of
 *  waiting states:
 *
 *   1. game over (CR 104) → nothing is awaited (`undefined`);
 *   2. a mid-resolution PendingChoice (CR 608.2 / 101.4) suspends the engine
 *      and outranks everything;
 *   3. target selection in progress (CR 601.2c);
 *   4. blocker declaration this combat (CR 509.1);
 *   5. otherwise priority (CR 117) — this also covers an in-progress
 *      spell/ability payment (pendingCast / pendingActivation), where the
 *      payer holds priority.
 *
 *  This is the single place the variant is decided; `refreshExpectedInput`
 *  stores the result and `assertExpectedInputCoherent` re-derives it to check
 *  coherence. */
export function computeExpectedInput(
    state: GameState
): ExpectedInput | undefined {
    // CR 104 — a finished game waits for no input.
    if (state.gameOver) return undefined;

    // CR 608.2 / 101.4 — a mid-resolution choice suspends the engine between
    // resolve steps; the FIFO front is the one awaiting input.
    const head = state.pendingChoices?.[0];
    if (head) {
        return {
            kind: "choice",
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
            choiceKind: head.kind,
        };
    }

    // CR 601.2c — target selection for a spell being cast / ability activated.
    if (state.pendingTarget) {
        return {
            kind: "target",
            playerId: state.pendingTarget.playerId,
            cardInstanceId: state.pendingTarget.cardInstanceId,
            targetType: state.pendingTarget.targetType,
        };
    }

    // CR 509.1 — the declare-blockers turn-based action. The declaring player
    // is the defending player, unless Melee (#669) hands block declaration to
    // the attacking (active) player. Only a live combat with attackers that
    // has not yet confirmed blockers rests here.
    if (
        state.phase === "DECLARE_BLOCKERS" &&
        state.combat &&
        state.combat.attackerIds.length > 0 &&
        !state.combat.blockersConfirmed
    ) {
        const declarer = state.meleeCombat
            ? state.activePlayerId
            : getOpponentId(state, state.activePlayerId);
        return { kind: "blockers", playerId: declarer };
    }

    // CR 117 — default: the game is waiting for the priority player to act.
    // A spell/ability payment in progress (pendingCast / pendingActivation)
    // falls through here: the payer holds priority while paying.
    return { kind: "priority", playerId: state.priorityPlayerId };
}

/** Maintain the authoritative `expectedInput` field on `state` (ADR 0047).
 *  Called by the engine at every stable point — in production via the
 *  persistence seam (`saveGameState` → here → `compactState`), and in the
 *  shared test fixtures (`makeState`) so every test carries a coherent value
 *  "for free". Mutates `state` in place. */
export function refreshExpectedInput(state: GameState): void {
    state.expectedInput = computeExpectedInput(state);
}

/** Runtime coherence invariant (ADR 0047): the scattered pending* fields +
 *  priority must agree with the authoritative `expectedInput`. Asserted inside
 *  shared test fixtures and (future) dev builds so incoherent field
 *  combinations become loud errors instead of silent bugs.
 *
 *  Semantics: when `expectedInput` is present it MUST deep-equal the value
 *  `computeExpectedInput` derives from the same state; an absent field is
 *  treated as "not yet materialized" and passes (a state built by hand that
 *  never went through `refreshExpectedInput`). Throwing — not returning a
 *  boolean — so a violation surfaces at the exact call site with a diagnostic. */
export function assertExpectedInputCoherent(state: GameState): void {
    const actual = state.expectedInput;
    if (actual === undefined) return;
    const expected = computeExpectedInput(state);
    if (!expectedInputEquals(actual, expected)) {
        throw new Error(
            `expectedInput incoherent with pending state (ADR 0047): ` +
                `field=${JSON.stringify(actual)} ` +
                `derived=${JSON.stringify(expected)}`
        );
    }
}

/** The kind discriminant of {@link ExpectedInput} — the input class a mutation
 *  declares it belongs to when it calls the gate. */
export type ExpectedInputKind = ExpectedInput["kind"];

/** Every {@link ExpectedInputKind}, as a value (ADR 0047, issue #801). Used by
 *  the gate parity tests to probe the gate across the full kind × player
 *  matrix. Exhaustiveness is compiler-enforced in BOTH directions: `satisfies`
 *  rejects a stray member, and the `Exclude` witness below fails to compile
 *  when a new ExpectedInput variant is added without extending this list. */
export const EXPECTED_INPUT_KINDS = [
    "choice",
    "target",
    "blockers",
    "priority",
] as const satisfies readonly ExpectedInputKind[];

/** Compile-time witness that {@link EXPECTED_INPUT_KINDS} covers every member
 *  of {@link ExpectedInputKind}. Adding a variant to the union without adding
 *  it to the list makes the conditional resolve to `never`, and assigning
 *  `true` to it errors. */
type MissingExpectedInputKind = Exclude<
    ExpectedInputKind,
    (typeof EXPECTED_INPUT_KINDS)[number]
>;
const _expectedInputKindsExhaustive: [MissingExpectedInputKind] extends [never]
    ? true
    : never = true;
void _expectedInputKindsExhaustive;

/** What a game mutation asks the single gate to authorize (ADR 0047, #799). */
export type GateRequest = {
    /** The player submitting the action. */
    playerId: string;
    /** The Expected Input kind this mutation's action belongs to. */
    expect: ExpectedInputKind;
    /** CR 117.3a / 605.3b — a mana-ability mutation. While a player is being
     *  asked an optional may-pay question the game's Expected Input is a
     *  `choice`, yet that player may still activate mana abilities to make the
     *  required mana. Set this so the gate admits the mana action during the
     *  player's own may-pay window instead of demanding priority. */
    allowManaForMayPay?: boolean;
    /** Combat sub-flows (assign / confirm combat damage, CR 510) fold into a
     *  priority window, but the acting player is owned by the sub-flow
     *  (`damageAssignerIds`), not by `priorityPlayerId`. Set this to check only
     *  the moment (a priority window, nothing else pending) and let the
     *  mutation validate the assigner identity itself. */
    anyPlayer?: boolean;
};

/** THE Expected Input gate (ADR 0047, issue #799). Every game mutation calls
 *  this once, before its action-specific validation, so the "right moment /
 *  right player / right input kind" question is answered in exactly one place.
 *
 *  It derives the authoritative Expected Input from `state` via
 *  {@link computeExpectedInput} (the single decision site — robust whether or
 *  not the persisted `expectedInput` field was materialized) and rejects when:
 *
 *   - the game is over (CR 104.2a — no further actions);
 *   - the game is waiting for a different KIND of input than the mutation
 *     submits (e.g. casting a spell while a Pending Choice is open); or
 *   - the input is the right kind but from the WRONG player (e.g. the
 *     non-active player submitting a choice owed by their opponent).
 *
 *  Throwing — not returning a boolean — so the rejection surfaces to the
 *  client as a consistent, single-sourced error. Per-mutation code keeps only
 *  its action-specific semantics (does this pendingCast exist, is this a legal
 *  target, etc.). */
export function assertExpectedInput(
    state: GameState,
    request: GateRequest
): void {
    // CR 104.2a — a finished game accepts no further actions.
    if (state.gameOver) {
        throw new Error("Game is over");
    }

    const current = computeExpectedInput(state);

    // CR 117.3a / 605.3b — mana abilities during the player's own may-pay
    // window are legal even though the Expected Input is a `choice`.
    if (
        request.allowManaForMayPay &&
        current?.kind === "choice" &&
        current.choiceKind === "may-pay" &&
        current.playerId === request.playerId
    ) {
        return;
    }

    if (!current || current.kind !== request.expect) {
        throw new Error(
            `Illegal action (ADR 0047): the game is waiting for ` +
                `${current ? current.kind : "nothing"} input, not ` +
                `${request.expect}.`
        );
    }

    if (!request.anyPlayer && current.playerId !== request.playerId) {
        throw new Error(
            `Illegal action (ADR 0047): the game is waiting for ` +
                `${current.kind} input from another player.`
        );
    }
}

/** Structural equality for two ExpectedInput values (or `undefined`). The
 *  union is flat plain-data, so a shallow key-by-key compare on the resolved
 *  variant is exact. */
function expectedInputEquals(
    a: ExpectedInput | undefined,
    b: ExpectedInput | undefined
): boolean {
    if (a === undefined || b === undefined) return a === b;
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case "choice":
            return (
                b.kind === "choice" &&
                a.playerId === b.playerId &&
                a.stackItemId === b.stackItemId &&
                a.choiceId === b.choiceId &&
                a.choiceKind === b.choiceKind
            );
        case "target":
            return (
                b.kind === "target" &&
                a.playerId === b.playerId &&
                a.cardInstanceId === b.cardInstanceId &&
                a.targetType === b.targetType
            );
        case "blockers":
            return b.kind === "blockers" && a.playerId === b.playerId;
        case "priority":
            return b.kind === "priority" && a.playerId === b.playerId;
    }
}
