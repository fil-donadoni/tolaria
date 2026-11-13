"use node";
// The game-end Verdict Proposal judge, on the server (GLOSSARY.md § Verdict
// Proposal).
//
// At a vs-Bot game's end the client asks, once per sampled decision of the
// human seat, which move the Brain would have picked on the seat's own view.
// This action answers ONE such position: it runs the very handler the client's
// Brain Worker runs (`convex/gre/ai/brainRequest.ts`) at a fixed iteration
// budget and seed and NO wall-clock cap, so the answer is the same on every
// machine and never depends on the player's device.
//
// The Node runtime because of memory: the engine plus the card catalogue
// already take most of the default runtime's per-call ceiling, and a search on
// top of them does not fit.
//
// Order is load-bearing: the guard (`verdictJudgeGuard.claimJudgeConsult`)
// authorizes and counts the call FIRST — a rejection throws before any search
// runs. A search FAILURE is not thrown: it comes back as `search-error`, so a
// bad position costs that one decision and the client's review goes on.
//
// It also measures itself, for the pilot's numbers: the server's own search
// time and the process's memory after the search, returned beside the move.

import { v, type Infer } from "convex/values";
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
    /** `process.memoryUsage().heapUsed` after the search, MiB — garbage not
     *  yet collected included, so an upper reading. */
    heapUsedMb: v.optional(v.number()),
    /** The process's peak resident set so far (`resourceUsage().maxRSS`),
     *  MiB — what a per-call memory ceiling is measured against. */
    peakRssMb: v.optional(v.number()),
});
export type VerdictJudgeResult = Infer<typeof verdictJudgeResultValidator>;

export type VerdictJudgeInput = {
    state: PublicGameState;
    botId: string;
    knowledge?: DeckKnowledgeBySeat;
    iterations: number;
    seed: number;
};

const MIB = 1024 * 1024;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Process memory, if this runtime exposes it — never a reason to fail. */
function memoryReading(): Pick<VerdictJudgeResult, "heapUsedMb" | "peakRssMb"> {
    try {
        if (typeof process === "undefined") return {};
        const heapUsedMb = round1(process.memoryUsage().heapUsed / MIB);
        // `maxRSS` is in KiB.
        const peakRssMb =
            typeof process.resourceUsage === "function"
                ? round1(process.resourceUsage().maxRSS / 1024)
                : undefined;
        return peakRssMb === undefined
            ? { heapUsedMb }
            : { heapUsedMb, peakRssMb };
    } catch {
        return {};
    }
}

/**
 * The judge's search for one position, already authorized: the Brain's
 * request handler at `{ iterations }` with `seed` and no time cap. Never
 * throws — the handler lowers a search throw to `error`. `search` is the
 * handler's own injection seam, for a test of the failure path.
 */
export function runVerdictJudge(
    input: VerdictJudgeInput,
    search?: typeof searchWithTrace
): VerdictJudgeResult {
    const start = performance.now();
    const res = handleBrainRequest(
        {
            id: 0,
            state: input.state,
            botId: input.botId,
            budget: { iterations: input.iterations },
            deckKnowledge: input.knowledge,
            seed: input.seed,
        },
        search
    );
    const searchMs = Math.round(performance.now() - start);
    const memory = memoryReading();
    if (res.error) {
        return {
            move: null,
            outcome: "search-error",
            message: res.error.message,
            searchMs,
            ...memory,
        };
    }
    const move: Move | null = res.move;
    return {
        move,
        outcome: move ? "move" : "no-move",
        searchMs,
        ...memory,
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
    // client compares with its own.
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
 * The action's body: authorize and count the call through the guard FIRST
 * (it throws, and nothing is searched, on a rejection), then search at the
 * budget the guard clamped. `search` is the handler's injection seam, so a
 * test can observe whether — and at what budget — a search ran.
 */
export async function judgeOnePosition(
    ctx: Pick<ActionCtx, "runMutation">,
    args: JudgePositionArgs,
    search?: typeof searchWithTrace
): Promise<VerdictJudgeResult> {
    const { iterations } = await ctx.runMutation(
        internal.verdictJudgeGuard.claimJudgeConsult,
        {
            gameId: args.gameId,
            seatId: args.botId,
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
