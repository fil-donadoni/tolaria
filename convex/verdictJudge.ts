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
// TWO RUNTIMES, chosen per game by the server (issue #10024). The public
// action always runs in the default runtime, where the guard is called; the
// search then runs either here or in the Node-runtime twin
// (`convex/verdictJudgeNode.ts`), by `verdictJudgeRuntime(gameId)` — a pure
// function of the game id the client has no argument to move. Node is a
// MEASUREMENT (ADR 0183 § Reopening this record: is a server search faster
// than a desktop browser?), and the answer names the runtime it ran in, so
// the counts line never mixes the two runtimes' numbers. The Node entry ships
// the engine and the card catalogue a second time — the one exception ADR
// 0113's Node seam admits (`scripts/__tests__/convex-node-bundle-seam.test.ts`).
//
// The default runtime's per-call memory ceiling is 64 MiB.
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
// rejection throws before any search runs, in either runtime. A search FAILURE
// is not thrown: it comes back as `search-error`, so a bad position costs that
// one decision and the client's review goes on. In Node that includes the
// Node action itself failing (out of memory, a cold start that dies): the
// default-runtime caller catches it — which the default runtime cannot do for
// its own isolate — and answers `search-error` naming the runtime.
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

/** One search's answer, in whichever runtime it ran. */
const verdictJudgeSearchFields = {
    // The engine's `Move` union — returned to the caller as-is, never stored
    // or trusted: the client compares it with the player's own move.
    move: v.union(v.any(), v.null()),
    outcome: v.union(
        v.literal("move"),
        v.literal("no-move"),
        v.literal("search-error")
    ),
    message: v.optional(v.string()),
    /** The server's own wall time of the search, ms — measured in the
     *  runtime that searched, so a Node answer's excludes the hop to it. */
    searchMs: v.number(),
};
export const verdictJudgeSearchValidator = v.object(verdictJudgeSearchFields);
export type VerdictJudgeSearchResult = Infer<
    typeof verdictJudgeSearchValidator
>;

export const verdictJudgeRuntimeValidator = v.union(
    v.literal("default"),
    v.literal("node")
);
/** The Convex runtime a judge search ran in (issue #10024). */
export type VerdictJudgeRuntime = Infer<typeof verdictJudgeRuntimeValidator>;

export const verdictJudgeResultValidator = v.object({
    ...verdictJudgeSearchFields,
    runtime: verdictJudgeRuntimeValidator,
});
export type VerdictJudgeResult = Infer<typeof verdictJudgeResultValidator>;

/** The share of games whose judge searches in the Node runtime (issue
 *  #10024): half, so both runtimes are measured over the same days and the
 *  same kind of positions. 0 retires the Node twin's traffic without a
 *  client change. */
export const VERDICT_JUDGE_NODE_SHARE = 0.5;

/**
 * The runtime a game's judge searches in: a pure function of the game id
 * (FNV-1a, 32 bit, finalized, as a fraction of 2^32) against `nodeShare`. Server-side by
 * construction — no argument of the action can move it — and stable, so every
 * consult of one game end runs in the same runtime.
 */
export function verdictJudgeRuntime(
    gameId: string,
    nodeShare: number = VERDICT_JUDGE_NODE_SHARE
): VerdictJudgeRuntime {
    let h = 0x811c9dc5;
    for (let i = 0; i < gameId.length; i++) {
        h ^= gameId.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    // Murmur3's finalizer: FNV alone leaves ids that differ in their last
    // character close together in the high bits this fraction reads.
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 2 ** 32 < nodeShare ? "node" : "default";
}

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
): VerdictJudgeSearchResult {
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

/** What one search needs — the public action's arguments without the game,
 *  and the Node twin's arguments as they are. */
export const judgeSearchArgs = {
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

export const judgePositionArgs = {
    gameId: v.id("games"),
    ...judgeSearchArgs,
};
export const judgePositionArgsValidator = v.object(judgePositionArgs);
export type JudgePositionArgs = Infer<typeof judgePositionArgsValidator>;

/**
 * The action's body: the payload bounds, then the guard, which authorizes
 * and counts the call (it throws, and nothing is searched, on a rejection),
 * then the search at the budget the guard clamped, in the game's runtime
 * (`verdictJudgeRuntime`). `search` is the handler's injection seam for the
 * in-process search, so a test can observe whether — and at what budget — a
 * search ran; the Node search is observed at `ctx.runAction`'s arguments.
 */
export async function judgeOnePosition(
    ctx: Pick<ActionCtx, "runMutation" | "runAction">,
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
    const input = {
        state: args.state as PublicGameState,
        botId: args.botId,
        knowledge: args.knowledge,
        iterations,
        seed: args.seed,
    };
    if (verdictJudgeRuntime(args.gameId) === "default") {
        return { ...runVerdictJudge(input, search), runtime: "default" };
    }
    return { ...(await searchInNode(ctx, input)), runtime: "node" };
}

/** The search in the Node twin. Its failure is this one decision's
 *  `search-error`, never a throw: the default runtime cannot catch its own
 *  isolate dying, but it can catch the Node action's. */
async function searchInNode(
    ctx: Pick<ActionCtx, "runAction">,
    input: Omit<VerdictJudgeInput, "state"> & { state: PublicGameState }
): Promise<VerdictJudgeSearchResult> {
    const start = Date.now();
    try {
        return await ctx.runAction(
            internal.verdictJudgeNode.searchPosition,
            input
        );
    } catch (cause: unknown) {
        return {
            move: null,
            outcome: "search-error",
            message: `The Node judge failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            searchMs: Date.now() - start,
        };
    }
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
