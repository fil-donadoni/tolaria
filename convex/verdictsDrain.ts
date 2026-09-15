"use node";

// The outbox drain (issue #3580, ADR 0128 §5) — the ONLY Convex code that
// writes to the Verdict Store. "Two credentials, never one": the writer's key
// lives in this deployment's environment and nowhere else, so everything that
// stores a verdict — a tester's judgement, the git corpus's migration — goes
// through one of the two actions below, on a deployment.
//
// It decides nothing. `verdictsOutbox.ts` decides what is uploaded, what counts
// as confirmed and when a row may slim; `verdicts.ts` owns the table. This
// file binds those decisions to the GCS writer and to two internal functions.
//
// `"use node"` because the GCS writer signs a JWT with `node:crypto`. Its import
// graph must stay clear of the card registry
// (`scripts/__tests__/convex-node-bundle-seam.test.ts`): it reaches the outbox
// and the store port, never `verdicts.ts`.

import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import {
    VERDICT_STORE_WRITE_KEY_ENV,
    verdictStoreWriterFromDeploymentEnv,
} from "./verdictStoreGcsWriter";
import {
    drainOutbox,
    verdictDeploymentOf,
    type OutboxDrainPorts,
    type OutboxDrainReport,
    type OutboxPage,
} from "./verdictsOutbox";
import {
    drainResolutionOutbox,
    type ResolutionDrainPorts,
    type ResolutionDrainReport,
    type ResolutionOutboxRow,
} from "./verdictResolutionsOutbox";

const refs = {
    pendingPage: makeFunctionReference<
        "query",
        { cursor: string | null },
        OutboxPage
    >("verdicts:pendingPage"),
    markStored: makeFunctionReference<
        "mutation",
        Parameters<OutboxDrainPorts["markStored"]>[0],
        "slimmed" | "already-slim"
    >("verdicts:markStored"),
    requireAdmin: makeFunctionReference<"query", Record<string, never>, null>(
        "auth:requireAdminQuery"
    ),
    pendingResolutions: makeFunctionReference<
        "query",
        Record<string, never>,
        ResolutionOutboxRow[]
    >("verdictResolutions:pendingResolutions"),
    markResolutionStored: makeFunctionReference<
        "mutation",
        Parameters<ResolutionDrainPorts["markResolutionStored"]>[0],
        null
    >("verdictResolutions:markResolutionStored"),
};

const pendingValidator = v.array(
    v.object({ rowId: v.string(), reason: v.string() })
);

const drainReportValidator = v.object({
    stored: v.number(),
    alreadySlim: v.number(),
    pending: pendingValidator,
    skipped: v.optional(v.string()),
    // The resolution outbox (issue #3582), drained after the verdicts so a
    // resolution never reaches the store ahead of the verdicts it names.
    resolutions: v.optional(
        v.object({ stored: v.number(), pending: pendingValidator })
    ),
});

async function runDrain(
    ctx: ActionCtx
): Promise<OutboxDrainReport & { resolutions: ResolutionDrainReport }> {
    const store = verdictStoreWriterFromDeploymentEnv();
    const verdicts = await drainOutbox({
        store,
        here: verdictDeploymentOf(process.env.CONVEX_CLOUD_URL),
        now: () => Date.now(),
        pendingPage: (cursor) => ctx.runQuery(refs.pendingPage, { cursor }),
        markStored: (args) => ctx.runMutation(refs.markStored, args),
    });
    const resolutions = await drainResolutionOutbox({
        store,
        now: () => Date.now(),
        pendingResolutions: () => ctx.runQuery(refs.pendingResolutions, {}),
        markResolutionStored: (args) =>
            ctx.runMutation(refs.markResolutionStored, args),
    });
    return { ...verdicts, resolutions };
}

/**
 * The scheduled drain — after every insert, and hourly from `crons.ts` so an
 * upload that failed is retried without anyone noticing it failed.
 *
 * A deployment WITHOUT the write key is not an error here: a local backend
 * never holds it (`docs/guides/verdict-store.md`), so its rows stay fat and
 * marked `local`, and this returns `skipped` instead of failing every hour.
 * A deployment with a key that is present but wrong still throws.
 */
export const drain = internalAction({
    args: {},
    returns: drainReportValidator,
    handler: async (ctx) => {
        if (!process.env[VERDICT_STORE_WRITE_KEY_ENV]) {
            return {
                stored: 0,
                alreadySlim: 0,
                pending: [],
                skipped: `${VERDICT_STORE_WRITE_KEY_ENV} is not set on this deployment`,
            };
        }
        return await runDrain(ctx);
    },
});

/**
 * The admin door for a bulk upload (issue #3580) — the migration's (issue
 * #3584): `verdicts:enqueueBulk` admits the batch, this drains it NOW and
 * returns the report, so the caller sees every row that was stored and every
 * one left pending, with the reason. Unlike `drain`, a missing key throws: an
 * admin asking for an upload must hear that none can happen here.
 */
export const drainNow = action({
    args: {},
    returns: drainReportValidator,
    handler: async (ctx) => {
        await ctx.runQuery(refs.requireAdmin, {});
        return await runDrain(ctx);
    },
});
