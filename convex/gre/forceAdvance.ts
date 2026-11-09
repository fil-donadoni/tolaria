// `forceAdvanceOwedInput` — the last line of defence of the Bot liveness
// guarantee (issue #9002, PRD issue #8998, ADR 0176). Whatever window the Bot
// owes, it returns a state where the game has moved past that window. Pure and
// auth-free: a server-side caller with no `ctx.auth` (the deadline sentinel, the
// client's stall hand-off) runs it, then saves the result.
//
// Per window, in order:
//   1. the LEGAL rung (`forceAdvanceLegal.ts`) — the CR-defined answer or
//      decline, through the same core the public mutation runs;
//   2. the FORCED DISCARD (`forceAdvanceDiscard.ts`) when the legal rung
//      throws, changes nothing, or leaves the Bot owed on the SAME container —
//      an explicit CR deviation, reported as a P0;
//   3. the Bot CONCEDES (CR 104.3a, reason `bot-fault`) when it is still owed
//      on that container after `FORCE_ADVANCE_MAX_STEPS` attempts, a discard
//      throws, or the post-state fails the `compactState` round-trip.
//
// It never throws: every rung runs on its own clone inside a guard, and a fault
// outside the rungs (a corrupted state) is itself a concede.

import {
    computeExpectedInput,
    computeOwedPlayerIds,
    refreshExpectedInput,
    type ExpectedInputKind,
} from "./expectedInput";
import { forcedDiscard } from "./forceAdvanceDiscard";
import { LEGAL_STEPS, type LegalStep } from "./forceAdvanceLegal";
import { compactState, expandState } from "./serialize";
import { endGame, type ExpectedInput, type GameState } from "./state";

/** How many rungs one call may take on the window it was handed before the Bot
 *  concedes. A legal rung or a discard normally closes the window in one. */
export const FORCE_ADVANCE_MAX_STEPS = 8;

/** One rung taken. `legal` — a CR-defined answer that worked; `discarded` — the
 *  forced discard ran (a CR deviation). Neither — a legal rung that failed
 *  (`error` says why), or the concede. */
export type ForceAdvanceStep = {
    kind: ExpectedInputKind;
    action: string;
    legal: boolean;
    discarded: boolean;
    error?: string;
};

/** `advanced` — every rung taken was legal (or nothing was owed); `discarded`
 *  — at least one forced discard ran; `conceded` — the Bot lost the game. */
export type ForceAdvanceOutcome = "advanced" | "discarded" | "conceded";

export type ForceAdvanceResult = {
    state: GameState;
    steps: ForceAdvanceStep[];
    outcome: ForceAdvanceOutcome;
};

export type ForceAdvanceOptions = {
    /** Replace a kind's legal rung — the seam the per-kind discard tests use to
     *  make the legal rung throw. Production callers pass nothing. */
    legalSteps?: Partial<Record<ExpectedInputKind, LegalStep>>;
};

/** The window the Bot owes, and the identity of the container holding it. */
type OwedWindow = { input: ExpectedInput; key: string };

/** Which container a window lives in. Two states owe the SAME container when
 *  they agree on this key: a rung that leaves it unchanged made no progress. */
function containerKey(state: GameState, input: ExpectedInput): string {
    switch (input.kind) {
        case "choice":
            return `choice:${input.stackItemId}:${input.choiceId}`;
        case "target":
            return `target:${state.pendingTarget?.kind ?? ""}:${input.cardInstanceId}`;
        case "blockers":
        case "sacrifice":
        case "attack-mana-tax":
            return `${input.kind}:${state.turn}`;
        case "priority":
            return [
                "priority",
                state.turn,
                state.phase,
                state.stack.map((s) => s.id).join(","),
                state.pendingCast?.cardInstanceId ?? "",
                state.pendingActivation?.cardInstanceId ?? "",
                state.pendingCompanionPay ? "companion" : "",
                String(state.combat?.confirmed ?? ""),
                String(state.combat?.damageConfirmed ?? ""),
                state.mulligan?.declaringPlayerId ?? "",
            ].join("|");
        default:
            return assertNever(input);
    }
}

/** The window `botPlayerId` owes in `state`, or `null` when it owes nothing
 *  (the game is over, or someone else is owed). Membership in
 *  `computeOwedPlayerIds` — never equality with one id — so a combat-damage
 *  assigner the priority window does not name still counts. */
export function botOwedWindow(
    state: GameState,
    botPlayerId: string
): OwedWindow | null {
    if (state.gameOver) return null;
    if (!computeOwedPlayerIds(state).includes(botPlayerId)) return null;
    const input = computeExpectedInput(state);
    if (!input) return null;
    return { input, key: containerKey(state, input) };
}

/** Save `state` as the persistence seam does (compacted, stored as JSON) and
 *  load it back. Throws when either half cannot. */
function saveAndReload(state: GameState): {
    stored: string;
    reloaded: GameState;
} {
    const stored = JSON.stringify(compactState(state));
    return { stored, reloaded: expandState(JSON.parse(stored)) };
}

/** True when `state` survives the persistence seam: it compacts to JSON, the
 *  document expands back, and the reloaded state is a FIXED POINT — saving and
 *  reloading it again stores the same document. (The first reload may fill a
 *  default, e.g. `staticSeq`, so the first document is not the comparand.) A
 *  state that fails cannot be saved, or does not reload as itself. */
export function roundTripsThroughCompactState(state: GameState): boolean {
    try {
        const first = saveAndReload(state).reloaded;
        const second = saveAndReload(first);
        return saveAndReload(second.reloaded).stored === second.stored;
    } catch {
        return false;
    }
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** CR 104.3a — the Bot concedes: it leaves the game and loses. Never throws: a
 *  state too corrupt to clone is ended on a shallow copy. */
function concede(state: GameState, botPlayerId: string): GameState {
    const players: unknown = state?.players;
    const winnerId =
        (Array.isArray(players)
            ? (players as { id?: unknown }[]).find((p) => p?.id !== botPlayerId)
                  ?.id
            : undefined) ?? "";
    const outcome = {
        winnerId,
        loserId: botPlayerId,
        reason: "bot-fault" as const,
    };
    try {
        const next = structuredClone(state);
        endGame(next, outcome);
        refreshExpectedInput(next);
        return next;
    } catch {
        return { ...state, gameOver: outcome, expectedInput: undefined };
    }
}

/** Run one rung on a clone of `state`. `ok` only when it did not throw and the
 *  Bot is no longer owed on `key` afterwards. */
function attempt(
    state: GameState,
    key: string,
    botPlayerId: string,
    rung: (s: GameState) => string
):
    | { ok: true; state: GameState; action: string }
    | { ok: false; action?: string; error: string } {
    const next = structuredClone(state);
    let action: string;
    try {
        action = rung(next);
    } catch (e) {
        return { ok: false, error: errorMessage(e) };
    }
    if (botOwedWindow(next, botPlayerId)?.key === key) {
        return {
            ok: false,
            action,
            error: "still owed on the same container",
        };
    }
    return { ok: true, state: next, action };
}

function advance(
    input: GameState,
    botPlayerId: string,
    options: ForceAdvanceOptions
): ForceAdvanceResult {
    const steps: ForceAdvanceStep[] = [];
    let state = structuredClone(input);
    const origin = botOwedWindow(state, botPlayerId);
    if (!origin) return { state, steps, outcome: "advanced" };

    let discarded = false;
    let closed = false;
    for (let i = 0; i < FORCE_ADVANCE_MAX_STEPS; i++) {
        const owed = botOwedWindow(state, botPlayerId);
        if (!owed || owed.key !== origin.key) {
            closed = true;
            break;
        }
        const kind = owed.input.kind;

        const legalStep = options.legalSteps?.[kind] ?? LEGAL_STEPS[kind];
        const legal = attempt(state, owed.key, botPlayerId, (s) =>
            legalStep(s, botPlayerId)
        );
        if (legal.ok) {
            state = legal.state;
            steps.push({
                kind,
                action: legal.action,
                legal: true,
                discarded: false,
            });
            continue;
        }
        steps.push({
            kind,
            action: legal.action ?? "legal-step",
            legal: false,
            discarded: false,
            error: legal.error,
        });

        const discard = attempt(state, owed.key, botPlayerId, (s) =>
            forcedDiscard(kind, s, botPlayerId)
        );
        if (!discard.ok) {
            steps.push({
                kind,
                action: discard.action ?? "forced-discard",
                legal: false,
                discarded: true,
                error: discard.error,
            });
            return conceded(input, botPlayerId, steps, kind);
        }
        state = discard.state;
        discarded = true;
        steps.push({
            kind,
            action: discard.action,
            legal: false,
            discarded: true,
        });
    }

    if (!closed && botOwedWindow(state, botPlayerId)?.key === origin.key) {
        return conceded(input, botPlayerId, steps, origin.input.kind);
    }
    refreshExpectedInput(state);
    if (!roundTripsThroughCompactState(state)) {
        steps.push({
            kind: origin.input.kind,
            action: "round-trip",
            legal: false,
            discarded: false,
            error: "post-state fails the compactState round-trip",
        });
        return conceded(input, botPlayerId, steps, origin.input.kind);
    }
    return { state, steps, outcome: discarded ? "discarded" : "advanced" };
}

/** Concede from the INPUT state — the rungs' partial work is dropped, so a
 *  state that failed to serialize is never the one saved. */
function conceded(
    input: GameState,
    botPlayerId: string,
    steps: ForceAdvanceStep[],
    kind: ExpectedInputKind
): ForceAdvanceResult {
    steps.push({ kind, action: "concede", legal: false, discarded: false });
    return {
        state: concede(input, botPlayerId),
        steps,
        outcome: "conceded",
    };
}

/** Advance whatever `botPlayerId` owes in `state` (see the file header). Pure:
 *  `state` is never mutated. Never throws. */
export function forceAdvanceOwedInput(
    state: GameState,
    botPlayerId: string,
    options: ForceAdvanceOptions = {}
): ForceAdvanceResult {
    try {
        return advance(state, botPlayerId, options);
    } catch (e) {
        let kind: ExpectedInputKind = "priority";
        try {
            kind = computeExpectedInput(state)?.kind ?? "priority";
        } catch {
            // A state too corrupt to read its own Expected Input.
        }
        return conceded(
            state,
            botPlayerId,
            [
                {
                    kind,
                    action: "fault",
                    legal: false,
                    discarded: false,
                    error: errorMessage(e),
                },
            ],
            kind
        );
    }
}

function assertNever(x: never): never {
    throw new Error(`Unhandled ExpectedInput: ${JSON.stringify(x)}`);
}
