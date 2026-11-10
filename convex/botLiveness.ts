// The server half of the Bot liveness guarantee (PRD issue #8998): a vs-AI
// game whose Bot is owed input moves on even when the Bot's client cannot
// move it. Today one entry, `reportStall` — the client driver's HAND-OFF when
// its escalation ladder ran out: the server force-advances the Bot's window
// (`forceAdvanceOwedInput`, ADR 0178), saves, and files the fault through the
// system bug-report channel. The player never clicks anything.
//
// The Bot seat comes from `botSeatId` (`matches.ts`), the one derivation every
// server path shares: no `botId` field exists, the Bot is the non-human seat.

import { ConvexError, v, type Infer } from "convex/values";
import { mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { getCurrentUserId } from "./auth";
import type { BotFault } from "./botFaultReport";
import { recordSystemBugReport } from "./bugReports";
import { tryGetDefinition } from "./cards";
import { finalizeGameOver } from "./game";
import { assertSeatOwnership } from "./gameLifecycle";
import { getLatestGameState, saveGameState } from "./gameStateStore";
import {
    botOwedWindow,
    forceAdvanceOwedInput,
    type ForceAdvanceResult,
} from "./gre/forceAdvance";
import type { ExpectedInput, GameState } from "./gre/state";
import { botSeatId } from "./matches";

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

/**
 * The Bot seat of a vs-AI game, and the proof the caller is its human player.
 * Throws for a game that is not vs-AI and for a caller who does not own the
 * human seat — in a vs-AI game the human owns BOTH handles (ADR 0000), so the
 * human seat is the one to check.
 */
function vsAiBotSeat(game: Doc<"games">, userId: string): string {
    const botId = botSeatId(game);
    if (!botId) throw new ConvexError("This game has no Bot seat.");
    const human = game.players.find((p) => p.id !== botId);
    if (!human) throw new ConvexError("This game has no human seat.");
    try {
        assertSeatOwnership(human.id, userId);
    } catch {
        throw new ConvexError("You are not the player of this game.");
    }
    return botId;
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
        ...(owed.kind === "target" ? { targetType: owed.targetType } : {}),
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

        const result = forceAdvanceOwedInput(state, botId);
        await recordSystemBugReport(ctx, {
            gameId: args.gameId,
            fault: botFaultFromForceAdvance({
                origin: "client-handoff",
                faultClass: args.cause ?? "ladder-exhausted",
                state,
                owed: owed.input,
                result,
            }),
            // The state AT the fault, before the advance is saved over it.
            snapshot: {
                seq: gameState.seq,
                state: state as unknown as Record<string, unknown>,
            },
            clientDiagnostics: args.diagnostics,
        });

        const nextSeq = gameState.seq + 1;
        await saveGameState(ctx, args.gameId, nextSeq, result.state, gameState);
        await finalizeGameOver(ctx, args.gameId, nextSeq, result.state);
        return { advanced: true, outcome: result.outcome };
    },
});
