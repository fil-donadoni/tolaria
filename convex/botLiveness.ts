// The server half of the Bot liveness guarantee (PRD issue #8998): a vs-AI
// game whose Bot is owed input moves on even when the Bot's client cannot
// move it. Two entries share one enforce path (`enforceBotWindow`): the server
// force-advances the Bot's window (`forceAdvanceOwedInput`, ADR 0178), files
// the fault through the system bug-report channel and saves. The player never
// clicks anything.
//
// - `reportStall` — the client driver's HAND-OFF when its escalation ladder
//   ran out.
// - `checkDeadline` — the server deadline: the one scheduled
//   check per game `saveGameState` arms while the Bot is owed
//   (`convex/botDeadline.ts`). It holds when no client acts at all.
//
// Beside them, OBSERVATION only (issue #9502): `reportConsultFailure` records
// a Brain consult that gave no answer (`search-error` / `worker-error` /
// `timeout`) — the case the ladder covers with legal passes, so neither entry
// above ever fires — and `getConsultFailures` reads it back by game id. It
// advances nothing and carries no consent-gated payload
// (`botConsultFailureStore.ts`).
//
// The Bot seat comes from `botSeatId` (`matches.ts`), the one derivation every
// server path shares: no `botId` field exists, the Bot is the non-human seat.

import { ConvexError, v, type Infer } from "convex/values";
import {
    internalMutation,
    internalQuery,
    mutation,
    type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { planBotDeadline } from "./botDeadline";
import { getCurrentUserId } from "./auth";
import {
    appendConsultFailure,
    boundedConsultMessage,
    consultFailureOutcomeValidator,
    consultFailureRecordValidator,
    readConsultFailureRow,
    readConsultFailures,
    type ConsultFailureRecord,
    type ConsultFailureSample,
} from "./botConsultFailureStore";
import type { BotFault } from "./botFaultReport";
import { recordSystemBugReport } from "./bugReports";
import { tryGetDefinition } from "./cards";
import { finalizeGameOver } from "./game";
import { getLatestGameState, saveGameState } from "./gameStateStore";
import {
    botOwedWindow,
    forceAdvanceOwedInput,
    type ForceAdvanceResult,
} from "./gre/forceAdvance";
import { legalActions } from "./gre/legalActions";
import type { ExpectedInput, GameState } from "./gre/state";
import { botSeatId } from "./matches";
import { vsAiSeats } from "./vsAiSeats";

/** Why the client handed the window off: its ladder ran out of rungs, or a
 *  decision-path throw (issue #8999) left it nothing to walk. */
export const stallCauseValidator = v.union(
    v.literal("ladder-exhausted"),
    v.literal("driver-error")
);

/** What a hand-off came to. A stale or no-longer-owed call is a no-op, not an
 *  error: the game moved between the client's decision and this mutation. */
const reportStallResultValidator = v.union(
    v.object({
        advanced: v.literal(true),
        outcome: v.union(
            v.literal("advanced"),
            v.literal("discarded"),
            v.literal("conceded")
        ),
    }),
    v.object({
        advanced: v.literal(false),
        reason: v.union(
            v.literal("no-state"),
            v.literal("stale-seq"),
            v.literal("not-owed")
        ),
    })
);
export type ReportStallResult = Infer<typeof reportStallResultValidator>;

/** The largest client diagnostics payload a report row keeps. The row also
 *  holds the frozen board, and a document over Convex's size limit fails the
 *  insert — and with it the advance, which must never wait on evidence. */
export const STALL_DIAGNOSTICS_MAX_BYTES = 256 * 1024;

/** The diagnostics as stored: verbatim, or — over the cap, or not
 *  serialisable — a note of why they are not. */
export function boundedDiagnostics(diagnostics: unknown): unknown {
    if (diagnostics === undefined) return undefined;
    let bytes: number;
    try {
        bytes = JSON.stringify(diagnostics).length;
    } catch {
        return { omitted: "not serialisable" };
    }
    return bytes > STALL_DIAGNOSTICS_MAX_BYTES
        ? { omitted: `over the ${STALL_DIAGNOSTICS_MAX_BYTES}-byte cap`, bytes }
        : diagnostics;
}

/** The Bot seat of a vs-AI game, once the caller is proven its human player
 *  (`vsAiSeats`). */
function vsAiBotSeat(game: Doc<"games">, userId: string): string {
    return vsAiSeats(game, userId).botId;
}

/** Name of the card whose stack item (or permanent) raised the owed window. */
function sourceCardName(
    state: GameState,
    input: ExpectedInput
): string | undefined {
    const id =
        input.kind === "choice"
            ? input.stackItemId
            : input.kind === "target"
              ? input.cardInstanceId
              : undefined;
    if (!id) return undefined;
    const instance =
        state.stack.find((s) => s.id === id) ??
        state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);
    const cardId = instance?.card?.id;
    return typeof cardId === "string"
        ? (tryGetDefinition(cardId)?.name ?? undefined)
        : undefined;
}

/**
 * The system report's fault for one force advance: the window the Bot owed,
 * where it came from, and the step log. A step "worked" when it carries no
 * error — the legal rung, the forced discard, or the concede that ended it.
 */
export function botFaultFromForceAdvance(input: {
    origin: BotFault["origin"];
    faultClass: string;
    state: GameState;
    owed: ExpectedInput;
    result: ForceAdvanceResult;
}): BotFault {
    const { owed } = input;
    const name = sourceCardName(input.state, owed);
    return {
        origin: input.origin,
        expectedKind: owed.kind,
        ...(owed.kind === "choice" ? { choiceKind: owed.choiceKind } : {}),
        // A multi-type requirement (`["Creature", "player"]`) as one string.
        ...(owed.kind === "target"
            ? { targetType: [owed.targetType].flat().join("|") }
            : {}),
        ...(name ? { sourceCardName: name } : {}),
        faultClass: input.faultClass,
        steps: input.result.steps.map((s) => ({
            step: s.action,
            ok: s.error === undefined,
            ...(s.discarded ? { discarded: true } : {}),
            ...(s.error !== undefined ? { message: s.error } : {}),
        })),
    };
}

/**
 * The client driver's hand-off (PRD issue #8998, layer 2): its escalation
 * ladder ran out on state version `seq`. Re-validated here — the caller is the
 * human of this vs-AI game, `seq` is still current, the Bot is still owed —
 * then the Bot's window is force-advanced, the fault filed as a system report
 * (origin `client-handoff`, with the client's diagnostics) and the result saved.
 */
export const reportStall = mutation({
    args: {
        gameId: v.id("games"),
        seq: v.number(),
        cause: v.optional(stallCauseValidator),
        // The driver's telemetry (decision ring, escalations, traces, console
        // ring). Stored on the report row verbatim, never parsed: evidence for
        // a human, like `submitBugReport`'s `clientDiagnostics`.
        diagnostics: v.optional(v.any()),
    },
    returns: reportStallResultValidator,
    handler: async (ctx, args): Promise<ReportStallResult> => {
        const userId = await getCurrentUserId(ctx);
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new ConvexError("Game not found.");
        const botId = vsAiBotSeat(game, userId);

        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) return { advanced: false, reason: "no-state" };
        if (gameState.seq !== args.seq) {
            return { advanced: false, reason: "stale-seq" };
        }
        const state = gameState.state as GameState;
        const owed = botOwedWindow(state, botId);
        if (!owed) return { advanced: false, reason: "not-owed" };

        const result = await enforceBotWindow(ctx, {
            gameId: args.gameId,
            gameState,
            botId,
            owed: owed.input,
            origin: "client-handoff",
            faultClass: args.cause ?? "ladder-exhausted",
            clientDiagnostics: boundedDiagnostics(args.diagnostics),
        });
        return { advanced: true, outcome: result.outcome };
    },
});

/**
 * The one enforce path both entries share: force-advance the Bot's owed
 * window, file the fault as a system report (the frozen board is the state AT
 * the fault, before the advance is saved over it), save the next seq and end
 * the game if the advance did.
 */
async function enforceBotWindow(
    ctx: MutationCtx,
    input: {
        gameId: Id<"games">;
        gameState: Doc<"gameStates">;
        botId: string;
        owed: ExpectedInput;
        origin: BotFault["origin"];
        faultClass: string;
        clientDiagnostics?: unknown;
    }
): Promise<ForceAdvanceResult> {
    const { gameId, gameState } = input;
    const state = gameState.state as GameState;
    const result = forceAdvanceOwedInput(state, input.botId);
    await recordSystemBugReport(ctx, {
        gameId,
        fault: botFaultFromForceAdvance({
            origin: input.origin,
            faultClass: input.faultClass,
            state,
            owed: input.owed,
            result,
        }),
        snapshot: {
            seq: gameState.seq,
            state: state as unknown as Record<string, unknown>,
        },
        clientDiagnostics: input.clientDiagnostics,
    });

    const nextSeq = gameState.seq + 1;
    await saveGameState(ctx, gameId, nextSeq, result.state, gameState);
    await finalizeGameOver(ctx, gameId, nextSeq, result.state);
    return result;
}

/** The fault class a server-deadline report carries: no client handed off. */
export const DEADLINE_FAULT_CLASS = "deadline-expired";

/** The note a server-deadline report keeps where a hand-off keeps the client's
 *  diagnostics: there are none, because no client acted. */
export const DEADLINE_DIAGNOSTICS = {
    note: "no client hand-off — driver dead or tab closed",
} as const;

/**
 * The server deadline (issue #9004, PRD issue #8998 layer 3): the ONE check
 * `saveGameState` scheduled for state version `seq` while the Bot was owed.
 * Decided by `planBotDeadline` off the tick row: the Bot no longer owed (it
 * acted, or the game ended) → drop the marker; owed at a newer seq → arm again
 * for that version's own deadline; same seq past the deadline → the driver is
 * dead, so the server force-advances the window (origin `server-deadline`).
 */
export const checkDeadline = internalMutation({
    args: { gameId: v.id("games"), seq: v.number() },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const tick = await ctx.db
            .query("gameTicks")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .first();
        if (!tick) return null;
        const gameState = await getLatestGameState(ctx, args.gameId);
        const state = gameState?.state as GameState | undefined;
        const botId =
            gameState && state
                ? botSeatId({ vsAi: gameState.vsAi, players: state.players })
                : null;
        const now = Date.now();
        const action = planBotDeadline({
            tick,
            botId,
            trigger: { kind: "check", seq: args.seq },
            now,
        });

        if (action.kind === "arm") {
            await ctx.scheduler.runAfter(
                Math.max(0, action.at - now),
                internal.botLiveness.checkDeadline,
                { gameId: args.gameId, seq: action.seq }
            );
            await ctx.db.patch(tick._id, { botDeadlineAt: action.at });
            return null;
        }
        // Every other outcome ends this check's watch: the marker goes BEFORE
        // an enforce saves, so the save re-arms if the Bot is owed again.
        await ctx.db.patch(tick._id, { botDeadlineAt: undefined });
        if (action.kind !== "enforce" || !gameState || !state || !botId) {
            return null;
        }
        const owed = botOwedWindow(state, botId);
        if (!owed) return null;
        await enforceBotWindow(ctx, {
            gameId: args.gameId,
            gameState,
            botId,
            owed: owed.input,
            origin: "server-deadline",
            faultClass: DEADLINE_FAULT_CLASS,
            clientDiagnostics: DEADLINE_DIAGNOSTICS,
        });
        return null;
    },
});

/** Whether the Bot could play a land right now (CR 305.2): a `play-land`
 *  among its legal priority actions. A throw reads as "unknown", never as a
 *  failed report — this is a diagnostic, not a gate. */
function botLandDropLegal(
    state: GameState,
    botId: string
): boolean | undefined {
    try {
        return legalActions(state).some(
            (a) =>
                a.playerId === botId &&
                a.expect === "priority" &&
                a.action.kind === "play-land"
        );
    } catch {
        return undefined;
    }
}

/**
 * Record one Brain consult that gave the Bot no answer (issue #9502). Sent
 * fire-and-forget by the vs-AI driver; changes nothing about the game. Same
 * authorization as `reportStall`: the caller is the human of this vs-AI game.
 *
 * Turn, phase and land-drop legality are read from the server's own state,
 * and only when it is still version `seq` — the one the consult ran on. A
 * report landing after the game moved keeps `seq` and the outcome alone.
 *
 * No consent-gated payload: the outcome, the coordinates the server already
 * knows and the Brain's error message, truncated (`botConsultFailureStore.ts`).
 */
export const reportConsultFailure = mutation({
    args: {
        gameId: v.id("games"),
        seq: v.number(),
        outcome: consultFailureOutcomeValidator,
        message: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const userId = await getCurrentUserId(ctx);
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new ConvexError("Game not found.");
        const botId = vsAiBotSeat(game, userId);

        const gameState = await getLatestGameState(ctx, args.gameId);
        const state =
            gameState && gameState.seq === args.seq
                ? (gameState.state as GameState)
                : undefined;
        const landDropLegal = state
            ? botLandDropLegal(state, botId)
            : undefined;
        const message = boundedConsultMessage(args.message);
        const sample: ConsultFailureSample = {
            outcome: args.outcome,
            seq: args.seq,
            at: Date.now(),
            ...(state ? { turn: state.turn, phase: state.phase } : {}),
            ...(landDropLegal !== undefined ? { landDropLegal } : {}),
            ...(message !== undefined ? { message } : {}),
        };

        const row = await readConsultFailureRow(ctx, args.gameId);
        const next = appendConsultFailure(row, sample);
        if (row) {
            await ctx.db.patch(row._id, next);
        } else {
            await ctx.db.insert("botConsultFailures", {
                gameId: args.gameId,
                ...next,
            });
        }
        return null;
    },
});

/**
 * A game's failed-consult record, for triage (`bunx convex run
 * botLiveness:getConsultFailures '{"gameId":"…"}' --prod`): `null` when its
 * Bot never failed a consult.
 */
export const getConsultFailures = internalQuery({
    args: { gameId: v.id("games") },
    returns: v.union(v.null(), consultFailureRecordValidator),
    handler: async (ctx, args): Promise<ConsultFailureRecord | null> =>
        await readConsultFailures(ctx, args.gameId),
});
