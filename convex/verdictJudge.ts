// The game-end Verdict Proposal judge, on the server (GLOSSARY.md § Verdict
// Proposal).
//
// At a vs-Bot game's end the client asks, once per sampled decision of the
// human seat, which move the Brain would have picked on the seat's own view.
// This action answers ONE such position: it runs the very handler the client's
// Brain Worker runs (`convex/gre/ai/brainRequest.ts`) at a fixed iteration
// budget and seed, so the answer is the same on every machine and never
// depends on the player's device.
//
// THE DEFAULT RUNTIME, not Node. The engine and the card catalogue are already
// in the default runtime's bundle (every game mutation runs them); a Node entry
// would ship them a second time. Its per-call memory ceiling is 64 MiB.
// Measured locally on 2026-11-13 (Node, the 56 searched blade `must`
// positions, at 400 and at 1320 iterations): every search completes with V8's
// old space capped at 64 MB, and the process dies at 40 MB — the need sits
// between the two, and the project's earlier probes put the isolate at about
// 0.6x Node's heap. Unverified on cloud: a call that runs out of memory fails
// the action, which the client counts as `judge.server-error` — that rate is
// what this pilot watches.
//
// Order is load-bearing. The payload and `knowledge` bounds are checked first
// (a rejected payload costs no counter), then the guard
// (`verdictJudgeGuard.claimJudgeConsult`) authorizes and counts the call — a
// rejection throws before any search runs. A search FAILURE is not thrown: it
// comes back as `search-error`, so a bad position costs that one decision and
// the client's review goes on.
//
// It times itself with `Date.now()` (the search is handed the same clock), for
// the pilot's numbers: the server's own search time, returned beside the move.

import { ConvexError, v, type Infer } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { handleBrainRequest, type BrainOutcome } from "./gre/ai/brainRequest";
import type { DeckKnowledgeBySeat } from "./gre/deckKnowledge";
import type { Move } from "./gre/moves";
import type { searchWithTrace } from "./gre/search";
import type { PublicGameState } from "./gameProjections";

/** How one judge consult ended on the server: the search's own three
 *  outcomes. A rejection by the guard is a thrown `ConvexError`, not one of
 *  these. */
export type VerdictJudgeOutcome = Extract<
    BrainOutcome,
    "move" | "no-move" | "search-error"
>;

export const verdictJudgeResultValidator = v.object({
    // The engine's `Move` union — returned to the caller as-is, never stored
    // or trusted: the client compares it with the player's own move.
    move: v.union(v.any(), v.null()),
    outcome: v.union(
        v.literal("move"),
        v.literal("no-move"),
        v.literal("search-error")
    ),
    message: v.optional(v.string()),
    /** The server's own wall time of the search, ms. */
    searchMs: v.number(),
});
export type VerdictJudgeResult = Infer<typeof verdictJudgeResultValidator>;

export type VerdictJudgeInput = {
    state: PublicGameState;
    botId: string;
    knowledge?: DeckKnowledgeBySeat;
    iterations: number;
    seed: number;
};

/** The wall-clock backstop on one judge search. An honest position finishes
 *  its iteration budget far inside it (the slowest of the blade `must`
 *  positions takes about 2 s at 400 iterations, locally); it exists so a
 *  crafted `state` cannot keep a search running for the action's whole
 *  lifetime. It is a CEILING, not part of the decision (`backstopMs`): a
 *  search that finishes under it answers exactly as without it, and one it
 *  ends is discarded — a clock-cut answer is not reproducible. */
export const VERDICT_JUDGE_BACKSTOP_MS = 30_000;

/** The largest `state` the judge accepts, serialized. The largest of the 546
 *  blade positions projected for their searching seat is 24,372 B (median
 *  2,640 B, measured 2026-11-13); 1 MiB is ~40x that, room for a long game's
 *  board, and still bounds what one call can make the server parse. */
export const VERDICT_JUDGE_STATE_MAX_BYTES = 1024 * 1024;

/** At most this many decklist entries per seat in `knowledge`: a Constructed
 *  maindeck plus sideboard is 75, a Limited pool a few dozen more. */
export const VERDICT_JUDGE_KNOWLEDGE_MAX_CARDS = 250;

/** The payload checks that need no database: reject before the guard is
 *  called, so a rejected payload costs no counter. */
export function assertJudgePayload(args: JudgePositionArgs): void {
    if (JSON.stringify(args.state).length > VERDICT_JUDGE_STATE_MAX_BYTES) {
        throw new ConvexError("The judge's position is too large.");
    }
    const knowledge = args.knowledge ?? [];
    if (knowledge.length > 2) {
        throw new ConvexError(
            "The judge's knowledge names more than two seats."
        );
    }
    if (
        knowledge.some(
            (k) => k.cardIds.length > VERDICT_JUDGE_KNOWLEDGE_MAX_CARDS
        )
    ) {
        throw new ConvexError("The judge's knowledge lists too many cards.");
    }
}

/**
 * The judge's search for one position, already authorized: the Brain's
 * request handler at `{ iterations }` with `seed`, under the wall-clock
 * backstop. Never throws — the handler lowers a search throw to `error`.
 * `search` is the handler's own injection seam, for tests.
 */
export function runVerdictJudge(
    input: VerdictJudgeInput,
    search?: typeof searchWithTrace
): VerdictJudgeResult {
    // `Date.now()`, never `performance.now()`: the default runtime is not
    // guaranteed to provide `performance`, and the search's own clock (its
    // default is `performance.now()`) is handed the same function.
    const now = () => Date.now();
    const start = now();
    const res = handleBrainRequest(
        {
            id: 0,
            state: input.state,
            botId: input.botId,
            budget: {
                iterations: input.iterations,
                backstopMs: VERDICT_JUDGE_BACKSTOP_MS,
                now,
            },
            deckKnowledge: input.knowledge,
            seed: input.seed,
        },
        search
    );
    const searchMs = now() - start;
    if (res.error) {
        return {
            move: null,
            outcome: "search-error",
            message: res.error.message,
            searchMs,
        };
    }
    if (res.trace?.stoppedBy === "time") {
        return {
            move: null,
            outcome: "search-error",
            message: `The ${VERDICT_JUDGE_BACKSTOP_MS} ms backstop cut the search short: no reproducible answer.`,
            searchMs,
        };
    }
    const move: Move | null = res.move;
    return {
        move,
        outcome: move ? "move" : "no-move",
        searchMs,
    };
}

export const judgePositionArgs = {
    gameId: v.id("games"),
    // The seat's own `PublicGameState` as `getPublicState` served it and
    // the client kept it: a large, deeply nested projection whose exact
    // shape is the engine's (`gameProjections.ts`), not a schema. It was
    // a Convex value when the server sent it, so it travels back as one;
    // what it may ask for is bounded by the guard, and nothing it holds
    // is stored or trusted — it only seeds a search whose move the
    // client compares with its own. Its size is bounded before anything
    // else runs (`VERDICT_JUDGE_STATE_MAX_BYTES`).
    state: v.any(),
    botId: v.string(),
    knowledge: v.optional(
        v.array(
            v.object({ playerId: v.string(), cardIds: v.array(v.string()) })
        )
    ),
    iterations: v.number(),
    seed: v.number(),
};
export const judgePositionArgsValidator = v.object(judgePositionArgs);
export type JudgePositionArgs = Infer<typeof judgePositionArgsValidator>;

/**
 * The action's body: the payload bounds, then the guard, which authorizes
 * and counts the call (it throws, and nothing is searched, on a rejection),
 * then the search at the budget the guard clamped. `search` is the handler's injection seam, so a
 * test can observe whether — and at what budget — a search ran.
 */
export async function judgeOnePosition(
    ctx: Pick<ActionCtx, "runMutation">,
    args: JudgePositionArgs,
    search?: typeof searchWithTrace
): Promise<VerdictJudgeResult> {
    assertJudgePayload(args);
    const { iterations } = await ctx.runMutation(
        internal.verdictJudgeGuard.claimJudgeConsult,
        {
            gameId: args.gameId,
            seatId: args.botId,
            // Only the seat ids, not the card lists: the guard checks each is
            // one of the game's two seats.
            knowledgeSeats: (args.knowledge ?? []).map((k) => k.playerId),
            iterations: args.iterations,
            seed: args.seed,
        }
    );
    return runVerdictJudge(
        {
            state: args.state as PublicGameState,
            botId: args.botId,
            knowledge: args.knowledge,
            iterations,
            seed: args.seed,
        },
        search
    );
}

/**
 * Judge ONE captured position of a finished vs-Bot game: the move the Brain
 * picks for the human seat on that seat's own view.
 */
export const judgePosition = action({
    args: judgePositionArgs,
    returns: verdictJudgeResultValidator,
    handler: (ctx, args): Promise<VerdictJudgeResult> =>
        judgeOnePosition(ctx, args),
});
