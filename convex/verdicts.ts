// Verdict intake (issue #3402, PRD #3397, ADR 0124 §1) — and, since issue
// #3580 (ADR 0128 §5), the OUTBOX of the Verdict Store.
//
// A Verdict is a tester's answer to "which move here?" about a decision the
// Bot has already made — the board, the candidate list, and which candidate
// was right. `convex/gre/ai/verdicts/types.ts` is the shape and the whole
// derivation of why it is a POSITION AND AN ANSWER rather than numbers; this
// module is only the door it comes in through.
//
// THE DIRECTION OF TRAVEL IS ONE WAY. Judgements are given in a browser,
// mid-game, where there is no filesystem — so they land in a table, FAT and
// stamped with both hashes (`verdictHash`, `positionKey`). A Node action
// (`verdictsDrain.ts`) uploads each to the Verdict Store and confirms it by
// re-reading; only then does `markStored` slim the row down to its hashes and
// provenance. The decisions — what is uploaded, what counts as confirmed, when
// a row may forget its judgement — live in `verdictsOutbox.ts`.
//
// VALIDATION PRECEDES THE UPLOAD, never follows it: a bucket accepts any
// bytes. Every check below runs in the mutation, so nothing the drain uploads
// was not refused-or-admitted here first.
//
// WHO MAY WRITE. `submit` is `assertIsTester`-gated, not `assertIsAdmin`: the
// point of the role is that judging a Bot decision and curating the shared
// admin surfaces are different trusts. Author, time, the attestation author
// and both hashes are stamped server-side and are NOT arguments — a client
// that could name the author could attribute a judgement to someone who never
// made it, and one that could name the hash could file a judgement under
// another's name.
import { makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";
import {
    internalMutation,
    internalQuery,
    mutation,
    type MutationCtx,
} from "./_generated/server";
import { assertIsAdmin, assertIsTester } from "./auth";
import {
    collectUnresolvedCardNames,
    scenarioSpecValidator,
} from "./debugScenarioSpec";
import { tryGetPlaceableCardByName } from "./cards";
import { findTokenSpec } from "./cards/tokenCatalogue";
import type { VerdictJudgement } from "./gre/ai/verdicts/identity";
import { VERDICT_AUTHOR_PATTERN, verdictAuthorOf } from "./verdictStore";
import {
    judgementOfRow,
    verdictDeploymentOf,
    verdictStampOf,
    type OutboxRow,
} from "./verdictsOutbox";

const seatValidator = v.union(v.literal("me"), v.literal("opp"));

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

const deckKnowledgeValidator = v.object({
    seat: seatValidator,
    cards: v.array(v.string()),
});

const deploymentKindValidator = v.union(v.literal("cloud"), v.literal("local"));

/** The drain, by name: `verdictsDrain.ts` is a `"use node"` module, and a
 *  reference by string keeps this file's typecheck independent of codegen
 *  (the precedent `uiGateAccounts.ts` sets). */
const DRAIN_OUTBOX = makeFunctionReference<
    "action",
    Record<string, never>,
    unknown
>("verdictsDrain:drain");

/** What every door checks before a judgement may enter the outbox. */
type AdmissibleJudgement = {
    spec: Infer<typeof scenarioSpecValidator>;
    candidates: { key: string; description: string }[];
    answer: Infer<typeof answerValidator>;
    botPickIndex?: number;
};

function assertAdmissible(args: AdmissibleJudgement): void {
    // Index bounds are checked HERE rather than left to the fit. An index
    // past the end of the candidate list is not a stale verdict — it is a
    // record that never meant anything, and the drain would happily upload it
    // where it would fail at fit time, far from whoever could still say what
    // they meant.
    const named =
        args.answer.kind === "right"
            ? args.answer.rightIndexes
            : args.answer.forbiddenIndexes;
    if (named.length === 0) {
        throw new Error("a verdict must name at least one candidate");
    }
    // A NAME THE ENGINE DOES NOT HAVE is refused here for exactly the reason
    // the index bounds below are: uploaded, the row fails at fit time as
    // "position could not be rebuilt" — far from whoever could still say what
    // they meant. Same check `saveDebugScenario` runs on the same vocabulary.
    const unresolved = collectUnresolvedCardNames(
        args.spec,
        (name) => tryGetPlaceableCardByName(name) !== null,
        (name) => findTokenSpec(name) !== undefined
    );
    if (unresolved.length > 0) {
        throw new Error(
            `unknown card name(s) in the position: ${unresolved.join(", ")}`
        );
    }

    // Two candidates with the same move key resolve to the same move on a
    // rebuilt position, so the pair built from them is permanently
    // unsatisfiable. The enumerator cannot produce one; a hand-built payload
    // can.
    const keys = new Set(args.candidates.map((c) => c.key));
    if (keys.size !== args.candidates.length) {
        throw new Error("two candidates carry the same move key");
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
}

/** Schedule a drain. Every door calls it after its insert: a drain that finds
 *  nothing costs one query, and one that races another stores nothing twice
 *  (`verdictsOutbox.ts` — idempotent by construction). */
async function scheduleDrain(ctx: MutationCtx): Promise<void> {
    await ctx.scheduler.runAfter(0, DRAIN_OUTBOX, {});
}

/**
 * Record one Verdict (issue #3402), stamped for the outbox (issue #3580).
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
        seat: seatValidator,
        // Decklists the search knew (`Verdict.deckKnowledge`). The quiz never
        // sends it; a cold judgement of a stored verdict must (issue #3582),
        // or its position key would differ from the one it is judging.
        deckKnowledge: v.optional(v.array(deckKnowledgeValidator)),
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
        assertAdmissible(args);
        const here = verdictDeploymentOf(process.env.CONVEX_CLOUD_URL);
        const judgement = {
            spec: args.spec,
            ...(args.setup === undefined ? {} : { setup: args.setup }),
            seat: args.seat,
            ...(args.deckKnowledge === undefined
                ? {}
                : { deckKnowledge: args.deckKnowledge }),
            candidates: args.candidates,
            answer: args.answer,
        } as VerdictJudgement;

        const id = await ctx.db.insert("verdicts", {
            spec: args.spec,
            ...(args.setup === undefined ? {} : { setup: args.setup }),
            seat: args.seat,
            ...(args.deckKnowledge === undefined
                ? {}
                : { deckKnowledge: args.deckKnowledge }),
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
            ...verdictStampOf(judgement),
            attestationAuthor: verdictAuthorOf(here.name, user._id),
            deployment: here.name,
            deploymentKind: here.kind,
        });
        await scheduleDrain(ctx);
        return id;
    },
});

/**
 * The bulk door (issue #3580) — how a batch of judgements that were NOT given
 * in play on this deployment enters the outbox: the git corpus's migration
 * (issue #3584) first. Admin-gated, and every entry passes the same checks as
 * `submit` before ANY is inserted (a throw rolls the whole mutation back).
 *
 * The attestation author is an ARGUMENT here, unlike in `submit`, because the
 * judge is not the caller: the admin running a migration is not the person
 * who gave the judgement. It must still have the `${deployment}:${userId}`
 * shape, so an email or a nickname is refused at the door. What the store is
 * written with is still only this deployment's credential, through the drain:
 * the caller follows this with `verdictsDrain:drainNow`, which returns the
 * report of what was stored and what was left pending.
 *
 * `deployment` is the deployment the row ENTERED the outbox on — the one
 * running the migration — even when `attestationAuthor` names another. The
 * author half says who judged; this says where the upload came from.
 */
export const enqueueBulk = mutation({
    args: {
        verdicts: v.array(
            v.object({
                spec: scenarioSpecValidator,
                setup: v.optional(v.array(v.any())),
                seat: seatValidator,
                deckKnowledge: v.optional(
                    v.array(
                        v.object({
                            seat: seatValidator,
                            cards: v.array(v.string()),
                        })
                    )
                ),
                candidates: v.array(candidateValidator),
                answer: answerValidator,
                botPickIndex: v.optional(v.number()),
                author: v.string(),
                attestationAuthor: v.string(),
                createdAt: v.number(),
                note: v.optional(v.string()),
            })
        ),
    },
    returns: v.array(v.id("verdicts")),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const here = verdictDeploymentOf(process.env.CONVEX_CLOUD_URL);
        const ids = [];
        for (const entry of args.verdicts) {
            assertAdmissible(entry);
            if (!VERDICT_AUTHOR_PATTERN.test(entry.attestationAuthor)) {
                throw new Error(
                    `attestation author ${JSON.stringify(entry.attestationAuthor)} is not \${deployment}:\${userId}`
                );
            }
            const judgement = {
                spec: entry.spec,
                ...(entry.setup === undefined ? {} : { setup: entry.setup }),
                seat: entry.seat,
                ...(entry.deckKnowledge === undefined
                    ? {}
                    : { deckKnowledge: entry.deckKnowledge }),
                candidates: entry.candidates,
                answer: entry.answer,
            } as VerdictJudgement;
            ids.push(
                await ctx.db.insert("verdicts", {
                    spec: entry.spec,
                    ...(entry.setup === undefined
                        ? {}
                        : { setup: entry.setup }),
                    seat: entry.seat,
                    ...(entry.deckKnowledge === undefined
                        ? {}
                        : { deckKnowledge: entry.deckKnowledge }),
                    candidates: entry.candidates,
                    answer: entry.answer,
                    ...(entry.botPickIndex === undefined
                        ? {}
                        : { botPickIndex: entry.botPickIndex }),
                    author: entry.author,
                    createdAt: entry.createdAt,
                    ...(entry.note === undefined ? {} : { note: entry.note }),
                    ...verdictStampOf(judgement),
                    attestationAuthor: entry.attestationAuthor,
                    deployment: here.name,
                    deploymentKind: here.kind,
                })
            );
        }
        // No drain is scheduled: the caller runs `verdictsDrain:drainNow` for
        // the report, and a scheduled drain racing it would upload every row
        // twice. The hourly cron covers a caller who never does.
        return ids;
    },
});

/**
 * The checks `submit` runs on a judgement, for one FORWARDED from a deployment
 * without the write key (issue #3745) — run on the writer, before it uploads
 * anything. The arguments are `submit`'s own validators, so a forwarded
 * judgement is refused by exactly what would refuse it here. Identity is the
 * forward token's business (`verdictForward.ts`), not this query's.
 */
export const forwardAdmissible = internalQuery({
    args: {
        spec: scenarioSpecValidator,
        setup: v.optional(v.array(v.any())),
        seat: seatValidator,
        deckKnowledge: v.optional(v.array(deckKnowledgeValidator)),
        candidates: v.array(candidateValidator),
        answer: answerValidator,
        botPickIndex: v.optional(v.number()),
    },
    returns: v.null(),
    handler: async (_ctx, args) => {
        assertAdmissible(args);
        return null;
    },
});

/** Rows per `pendingPage`. A fat row averages ~6 KB (ADR 0128 § Context), so
 *  a page stays far inside a query's read limits. */
const OUTBOX_PAGE_SIZE = 25;

/**
 * One page of rows not yet confirmed stored (issue #3580) — the drain's read.
 * Pending means no `storedAt`: rows written before the outbox existed carry
 * none either, so they are drained like any other.
 *
 * `rows` is `v.any()`: the drain reads them through `OutboxRow`, and this is
 * an internal function whose only caller is that drain.
 */
export const pendingPage = internalQuery({
    args: { cursor: v.union(v.string(), v.null()) },
    returns: v.object({
        rows: v.array(v.any()),
        cursor: v.string(),
        isDone: v.boolean(),
    }),
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("verdicts")
            .withIndex("by_storedAt", (q) => q.eq("storedAt", undefined))
            .paginate({ numItems: OUTBOX_PAGE_SIZE, cursor: args.cursor });
        return {
            rows: page.page,
            cursor: page.continueCursor,
            isDone: page.isDone,
        };
    },
});

/**
 * Slim one row whose verdict object and attestation the drain has uploaded AND
 * re-read (issue #3580, ADR 0128 §5).
 *
 * It trusts the drain's word for nothing it can check itself: the hashes are
 * re-derived from the row's own judgement and must match what the drain
 * stored, and a row already stamped must carry the same stamps and author.
 * A mismatch throws and the row stays fat — slimming it would leave a hash
 * that names an object the store does not hold under that judgement.
 *
 * The slim row is built by ALLOW-LIST, never "the row minus the judgement":
 * a field added to the table later is dropped by default rather than kept by
 * accident.
 */
export const markStored = internalMutation({
    args: {
        rowId: v.id("verdicts"),
        verdictHash: v.string(),
        positionKey: v.string(),
        attestationAuthor: v.string(),
        deployment: v.string(),
        deploymentKind: deploymentKindValidator,
        storedAt: v.number(),
    },
    returns: v.union(v.literal("slimmed"), v.literal("already-slim")),
    handler: async (ctx, args) => {
        const row = await ctx.db.get(args.rowId);
        if (row === null) {
            throw new Error(`verdict row ${args.rowId} does not exist`);
        }
        const judgement = judgementOfRow(row as unknown as OutboxRow);
        if (judgement === null) return "already-slim";

        const stamp = verdictStampOf(judgement);
        if (
            stamp.verdictHash !== args.verdictHash ||
            stamp.positionKey !== args.positionKey
        ) {
            throw new Error(
                `verdict row ${args.rowId} hashes to ${stamp.verdictHash}, not the stored ${args.verdictHash}`
            );
        }
        if (
            (row.verdictHash !== undefined &&
                row.verdictHash !== args.verdictHash) ||
            (row.positionKey !== undefined &&
                row.positionKey !== args.positionKey)
        ) {
            throw new Error(
                `verdict row ${args.rowId} was stamped ${row.verdictHash}, not the stored ${args.verdictHash}`
            );
        }
        if (
            row.attestationAuthor !== undefined &&
            row.attestationAuthor !== args.attestationAuthor
        ) {
            throw new Error(
                `verdict row ${args.rowId} is attested by ${row.attestationAuthor}, not ${args.attestationAuthor}`
            );
        }

        await ctx.db.replace(row._id, {
            verdictHash: args.verdictHash,
            positionKey: args.positionKey,
            ...(row.authorId === undefined ? {} : { authorId: row.authorId }),
            author: row.author,
            attestationAuthor: args.attestationAuthor,
            deployment: args.deployment,
            deploymentKind: args.deploymentKind,
            createdAt: row.createdAt,
            ...(row.note === undefined ? {} : { note: row.note }),
            ...(row.gameId === undefined ? {} : { gameId: row.gameId }),
            storedAt: args.storedAt,
        });
        return "slimmed";
    },
});
