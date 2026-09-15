"use node";

// The Verdict review surface's doors (issue #3582, PRD #3574, ADR 0128 §6).
//
// Actions, because the surface reads the Verdict Store, and the store is
// reached only with this deployment's write credential in a `"use node"`
// module (`verdictsDrain.ts` holds the same key; the writer can read). A
// deployment without the key — every local backend — reads its own outbox
// only, and says so (`storeRead: false`).
//
// Admin-gated through the internal functions they call first
// (`verdictResolutions.reviewOutbox` asserts it with the caller's identity).
// They decide nothing: `verdictReview.ts` merges and classifies, and
// `verdictResolutions.record` stamps and writes.
//
// COST. `review` reads every object in the store — one list per prefix and
// one GET per object — because contested positions are exactly what no
// Verdict Lock names yet, so the pack cannot serve it. At the corpus's current
// size that is a few hundred requests per click; the day it is thousands, the
// read wants a cache of its own.

import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { readStoredCorpus } from "./verdictStore";
import {
    VERDICT_STORE_WRITE_KEY_ENV,
    verdictStoreWriterFromDeploymentEnv,
} from "./verdictStoreGcsWriter";
import { verdictDeploymentOf, type OutboxRow } from "./verdictsOutbox";
import type { ResolutionOutboxRow } from "./verdictResolutionsOutbox";
import {
    localUserIdOf,
    openVerdictOf,
    resolutionAgainst,
    reviewSourcesOf,
    verdictReviewOf,
    type NicknameOf,
    type ReviewSources,
} from "./verdictReview";

const refs = {
    reviewOutbox: makeFunctionReference<
        "query",
        Record<string, never>,
        { verdictRows: OutboxRow[]; resolutionRows: ResolutionOutboxRow[] }
    >("verdictResolutions:reviewOutbox"),
    authorNicknames: makeFunctionReference<
        "query",
        { userIds: string[] },
        { userId: string; nickname: string }[]
    >("verdictResolutions:authorNicknames"),
    record: makeFunctionReference<
        "mutation",
        {
            positionKey: string;
            acceptedVerdictId: string | null;
            rejected: { verdictId: string; reason: string }[];
            note?: string;
        },
        string
    >("verdictResolutions:record"),
};

async function loadReview(ctx: ActionCtx): Promise<{
    sources: ReviewSources;
    nicknameOf: NicknameOf;
    storeRead: boolean;
}> {
    // The table BEFORE the store. A row the drain stores and slims between
    // the two reads is then in the store's listing; in the other order it
    // would be in neither.
    const outbox = await ctx.runQuery(refs.reviewOutbox, {});
    const here = verdictDeploymentOf(process.env.CONVEX_CLOUD_URL);
    const storeRead = Boolean(process.env[VERDICT_STORE_WRITE_KEY_ENV]);
    const stored = storeRead
        ? await readStoredCorpus(verdictStoreWriterFromDeploymentEnv())
        : null;
    const sources = reviewSourcesOf({
        stored,
        verdictRows: outbox.verdictRows,
        resolutionRows: outbox.resolutionRows,
        here,
    });
    const userIds = [
        ...new Set(
            [
                ...sources.attestations.map((a) => a.author),
                ...sources.resolutions.map((r) => r.author),
            ]
                .map((author) => localUserIdOf(author, here))
                .filter((id): id is string => id !== null)
        ),
    ];
    const nicknames = new Map(
        (await ctx.runQuery(refs.authorNicknames, { userIds })).map((row) => [
            row.userId,
            row.nickname,
        ])
    );
    const nicknameOf: NicknameOf = (author) => {
        const userId = localUserIdOf(author, here);
        return userId === null ? undefined : nicknames.get(userId);
    };
    return { sources, nicknameOf, storeRead };
}

/** Every contested and resolved position (`VerdictReview`). The return is
 *  `v.any()`: a position carries a whole `ScenarioSpec`, whose validator is
 *  the scenario write path's and grows with it. */
export const review = action({
    args: {},
    returns: v.any(),
    handler: async (ctx) => {
        const { sources, nicknameOf, storeRead } = await loadReview(ctx);
        return verdictReviewOf(sources, nicknameOf, storeRead);
    },
});

/** One verdict by id, for cold judging (`ReviewVerdict`), or `null`. */
export const openVerdict = action({
    args: { verdictId: v.string() },
    returns: v.any(),
    handler: async (ctx, args) => {
        const { sources, nicknameOf } = await loadReview(ctx);
        return openVerdictOf(sources, args.verdictId.trim(), nicknameOf);
    },
});

/**
 * Resolve a contested position: the accepted verdict (or `null`) and a reason
 * for every other one. Refused when the decision is not about exactly the
 * verdicts the position holds NOW. Returns the resolution id.
 */
export const resolve = action({
    args: {
        positionKey: v.string(),
        acceptedVerdictId: v.union(v.string(), v.null()),
        rejected: v.array(
            v.object({ verdictId: v.string(), reason: v.string() })
        ),
        note: v.optional(v.string()),
    },
    returns: v.string(),
    handler: async (ctx, args) => {
        const { sources } = await loadReview(ctx);
        const refusal = resolutionAgainst(sources, args);
        if (refusal !== null) throw new Error(refusal);
        return await ctx.runMutation(refs.record, args);
    },
});
