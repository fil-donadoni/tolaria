// Verdict intake (issue #3402, PRD #3397, ADR 0124 §1).
//
// A Verdict is a tester's answer to "which move here?" about a decision the
// Bot has already made — the board, the candidate list, and which candidate
// was right. `convex/gre/ai/verdicts/types.ts` is the shape and the whole
// derivation of why it is a POSITION AND AN ANSWER rather than numbers; this
// module is only the door it comes in through.
//
// THE DIRECTION OF TRAVEL IS ONE WAY. Judgements are given in a browser,
// mid-game, where there is no filesystem — so they land in a table. The fit
// never reads that table: `bun run verdicts:pull` exports every row to
// `data/verdicts/<id>.json`, and the corpus the fit consumes is the git
// directory (`convex/gre/ai/verdicts/fileSource.ts`). A fit whose corpus lived
// in a deployment could not be reproduced from a checkout, which ADR 0124 §3
// forbids.
//
// WHO MAY WRITE. `submit` is `assertIsTester`-gated, not `assertIsAdmin`: the
// point of the role is that judging a Bot decision and curating the shared
// admin surfaces are different trusts. Author and time are stamped from
// `ctx.auth` and are NOT arguments — a client that could name the author could
// attribute a judgement to someone who never made it.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertIsAdmin, assertIsTester } from "./auth";
import { scenarioSpecValidator } from "./debugScenarioSpec";

/** One enumerated candidate: the structural move key plus the describer's
 *  sentence. Mirrors `VerdictCandidate` (`gre/ai/verdicts/types.ts`). */
const candidateValidator = v.object({
    key: v.string(),
    description: v.string(),
});

/** The judgement. Mirrors `VerdictAnswer` — a discriminated union so a
 *  `forbidden` record can never be read as naming a right move. */
const answerValidator = v.union(
    v.object({ kind: v.literal("right"), rightIndexes: v.array(v.number()) }),
    v.object({
        kind: v.literal("forbidden"),
        forbiddenIndexes: v.array(v.number()),
    })
);

/** The row as `list` projects it — everything `verdicts:pull` needs to write a
 *  `Verdict` file, and nothing else. */
const verdictRowValidator = v.object({
    _id: v.id("verdicts"),
    spec: v.any(),
    setup: v.optional(v.any()),
    seat: v.union(v.literal("me"), v.literal("opp")),
    candidates: v.array(candidateValidator),
    answer: answerValidator,
    botPickIndex: v.optional(v.number()),
    gameId: v.optional(v.string()),
    seq: v.optional(v.number()),
    author: v.string(),
    createdAt: v.number(),
    note: v.optional(v.string()),
});

/**
 * Record one Verdict (issue #3402).
 *
 * `spec` is validated through the SAME `scenarioSpecValidator` the scenario
 * write path uses — a verdict's position is a scenario, and a second, laxer
 * spec validator would be a way for an unloadable board to enter the corpus.
 *
 * `setup` is `v.array(v.any())`, deliberately: `BladeSetupStep` is a thirty-arm
 * union whose arms grow with the blade suite, and restating it as a Convex
 * validator would be the union written twice — the copy would rot, and the
 * failure mode of a rotten copy is refusing a legitimate judgement at the
 * moment a tester gives it. The real check happens where it can be meaningful:
 * `buildVerdictState` replays these steps through the engine, and a step that
 * no longer applies is REPORTED as a stale verdict by `collectVerdictReport`
 * rather than silently dropped.
 */
export const submit = mutation({
    args: {
        spec: scenarioSpecValidator,
        setup: v.optional(v.array(v.any())),
        seat: v.union(v.literal("me"), v.literal("opp")),
        candidates: v.array(candidateValidator),
        answer: answerValidator,
        botPickIndex: v.optional(v.number()),
        gameId: v.optional(v.string()),
        seq: v.optional(v.number()),
        note: v.optional(v.string()),
    },
    returns: v.id("verdicts"),
    handler: async (ctx, args) => {
        const user = await assertIsTester(ctx);

        // Index bounds are checked HERE rather than left to the fit. An index
        // past the end of the candidate list is not a stale verdict — it is a
        // record that never meant anything, and the exporter would happily
        // write it into git where it would fail at fit time, far from whoever
        // could still say what they meant.
        const named =
            args.answer.kind === "right"
                ? args.answer.rightIndexes
                : args.answer.forbiddenIndexes;
        if (named.length === 0) {
            throw new Error("a verdict must name at least one candidate");
        }
        const bound = args.candidates.length;
        for (const index of [
            ...named,
            ...(args.botPickIndex === undefined ? [] : [args.botPickIndex]),
        ]) {
            if (!Number.isInteger(index) || index < 0 || index >= bound) {
                throw new Error(
                    `candidate index ${index} is outside the ${bound}-candidate list`
                );
            }
        }

        return await ctx.db.insert("verdicts", {
            spec: args.spec,
            ...(args.setup === undefined ? {} : { setup: args.setup }),
            seat: args.seat,
            candidates: args.candidates,
            answer: args.answer,
            ...(args.botPickIndex === undefined
                ? {}
                : { botPickIndex: args.botPickIndex }),
            ...(args.gameId === undefined ? {} : { gameId: args.gameId }),
            ...(args.seq === undefined ? {} : { seq: args.seq }),
            // Stamped, never taken from the client.
            authorId: user._id,
            author: user.nickname,
            createdAt: Date.now(),
            ...(args.note === undefined ? {} : { note: args.note }),
        });
    },
});

/**
 * Every verdict, oldest first (issue #3402) — what `bun run verdicts:pull`
 * reads and what the admin page shows.
 *
 * Admin-gated rather than tester-gated: submitting your own judgement and
 * reading everybody's are different things, and the export is an admin
 * operation. Ordered by the `by_createdAt` index so the export is
 * deterministic without the script having to sort (it sorts anyway, by file
 * name — but a listing whose order depended on insertion history would make
 * the FIRST-run diff depend on when rows happened to be written).
 */
export const list = query({
    args: {},
    returns: v.array(verdictRowValidator),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        const rows = await ctx.db
            .query("verdicts")
            .withIndex("by_createdAt")
            .order("asc")
            .collect();
        return rows.map((row) => ({
            _id: row._id,
            spec: row.spec,
            ...(row.setup === undefined ? {} : { setup: row.setup }),
            seat: row.seat,
            candidates: row.candidates,
            answer: row.answer,
            ...(row.botPickIndex === undefined
                ? {}
                : { botPickIndex: row.botPickIndex }),
            ...(row.gameId === undefined ? {} : { gameId: row.gameId }),
            ...(row.seq === undefined ? {} : { seq: row.seq }),
            author: row.author,
            createdAt: row.createdAt,
            ...(row.note === undefined ? {} : { note: row.note }),
        }));
    },
});
