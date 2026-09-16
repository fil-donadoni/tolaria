"use node";

// The outbox drain (issue #3580, ADR 0128 §5) — the ONLY Convex code that
// writes to the Verdict Store. The writer's key lives in the cloud
// deployments' environment and nowhere else, so everything that stores a
// verdict — a tester's judgement, the git corpus's migration — goes through
// the actions below, on a deployment.
//
// A deployment WITHOUT the key (every local backend) drains by FORWARDING
// (issue #3745): with a forward token and the writer's URL, each fat row goes
// to the writer's HTTP route (`verdictForwardHttp.ts`), which re-validates and
// stores it through `storeForwardedVerdict` / `storeForwardedResolution` below.
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
    VERDICT_STORE_FORWARD_TOKEN_ENV,
    VERDICT_STORE_FORWARD_URL_ENV,
    forwardOutboxStore,
    forwardResolutionStore,
    httpForwardTransport,
} from "./verdictForward";
import {
    directOutboxStore,
    drainOutbox,
    storeOutboxRow,
    verdictDeploymentOf,
    type OutboxDrainPorts,
    type OutboxDrainReport,
    type OutboxPage,
    type OutboxRow,
    type OutboxRowStore,
} from "./verdictsOutbox";
import {
    directResolutionStore,
    drainResolutionOutbox,
    storeResolutionRow,
    type ResolutionDrainPorts,
    type ResolutionDrainReport,
    type ResolutionOutboxRow,
    type ResolutionRowStore,
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
    // The resolution outbox (issue #3582), drained after the verdicts. A
    // verdict row left pending does not hold its resolution back; a reader
    // of the store alone then sees fewer verdicts than the resolution decided
    // over, so the resolution does not match and the position stays
    // contested — the safe direction.
    resolutions: v.optional(
        v.object({ stored: v.number(), pending: pendingValidator })
    ),
});

/** How this deployment stores a row, decided by the credentials its
 *  environment holds: the write key uploads directly; a forward token and the
 *  writer's URL forward; neither stores nothing, and says why. */
type DrainStores =
    | { storeRow: OutboxRowStore; storeResolution: ResolutionRowStore }
    | { cannot: string };

export function drainStoresFromEnv(
    env: Record<string, string | undefined>
): DrainStores {
    if (env[VERDICT_STORE_WRITE_KEY_ENV]) {
        const store = verdictStoreWriterFromDeploymentEnv();
        return {
            storeRow: directOutboxStore(
                store,
                verdictDeploymentOf(env.CONVEX_CLOUD_URL)
            ),
            storeResolution: directResolutionStore(store),
        };
    }
    const token = env[VERDICT_STORE_FORWARD_TOKEN_ENV];
    const url = env[VERDICT_STORE_FORWARD_URL_ENV];
    if (token && url) {
        const transport = httpForwardTransport(url, token);
        return {
            storeRow: forwardOutboxStore(
                transport,
                verdictDeploymentOf(env.CONVEX_CLOUD_URL)
            ),
            storeResolution: forwardResolutionStore(transport),
        };
    }
    return {
        cannot:
            `${VERDICT_STORE_WRITE_KEY_ENV} is not set on this deployment, ` +
            `and neither is a ${VERDICT_STORE_FORWARD_TOKEN_ENV} with its ${VERDICT_STORE_FORWARD_URL_ENV}`,
    };
}

async function runDrain(
    ctx: ActionCtx,
    stores: Exclude<DrainStores, { cannot: string }>
): Promise<OutboxDrainReport & { resolutions: ResolutionDrainReport }> {
    const verdicts = await drainOutbox({
        storeRow: stores.storeRow,
        now: () => Date.now(),
        pendingPage: (cursor) => ctx.runQuery(refs.pendingPage, { cursor }),
        markStored: (args) => ctx.runMutation(refs.markStored, args),
    });
    const resolutions = await drainResolutionOutbox({
        storeRow: stores.storeResolution,
        now: () => Date.now(),
        pendingResolutions: () => ctx.runQuery(refs.pendingResolutions, {}),
        markResolutionStored: async (args) => {
            await ctx.runMutation(refs.markResolutionStored, args);
        },
    });
    return { ...verdicts, resolutions };
}

/**
 * The scheduled drain — after every insert, and hourly from `crons.ts` so an
 * upload that failed is retried without anyone noticing it failed.
 *
 * A local backend never holds the write key (`docs/guides/verdict-store.md`);
 * with a forward token it forwards (issue #3745), and a row the writer
 * refuses or cannot reach stays fat, its reason in `pending`, retried next
 * hour. With neither credential this is not an error either: the rows stay
 * fat and marked `local`, and this returns `skipped` instead of failing every
 * hour. A key that is present but wrong still throws.
 */
export const drain = internalAction({
    args: {},
    returns: drainReportValidator,
    handler: async (ctx) => {
        const stores = drainStoresFromEnv(process.env);
        if ("cannot" in stores) {
            return {
                stored: 0,
                alreadySlim: 0,
                pending: [],
                skipped: stores.cannot,
            };
        }
        return await runDrain(ctx, stores);
    },
});

/**
 * The admin door for a bulk upload (issue #3580) — the migration's (issue
 * #3584): `verdicts:enqueueBulk` admits the batch, this drains it NOW and
 * returns the report, so the caller sees every row that was stored and every
 * one left pending, with the reason. Unlike `drain`, a deployment that can
 * neither upload nor forward throws: an admin asking for an upload must hear
 * that none can happen here.
 */
export const drainNow = action({
    args: {},
    returns: drainReportValidator,
    handler: async (ctx) => {
        await ctx.runQuery(refs.requireAdmin, {});
        const stores = drainStoresFromEnv(process.env);
        if ("cannot" in stores) throw new Error(stores.cannot);
        return await runDrain(ctx, stores);
    },
});

const putOutcomeValidator = v.union(v.literal("created"), v.literal("exists"));

/**
 * The writer's upload of ONE forwarded verdict (issue #3745) — called only by
 * the forward route, after the token, the origin and the judgement have been
 * checked (`verdictForward.ts`). Stores through the same `storeOutboxRow` a
 * direct drain uses: verdict, attestation, re-read. Throws on a deployment
 * without the write key, which the route answers as pending.
 */
export const storeForwardedVerdict = internalAction({
    args: { row: v.any() },
    returns: v.union(
        v.object({
            status: v.literal("stored"),
            rowId: v.string(),
            verdictHash: v.string(),
            positionKey: v.string(),
            attestationAuthor: v.string(),
            deployment: v.string(),
            deploymentKind: v.union(v.literal("cloud"), v.literal("local")),
            verdict: putOutcomeValidator,
            attestation: putOutcomeValidator,
        }),
        v.object({ status: v.literal("already-slim"), rowId: v.string() }),
        v.object({
            status: v.literal("pending"),
            rowId: v.string(),
            reason: v.string(),
        })
    ),
    handler: async (_ctx, args) => {
        return await storeOutboxRow(
            verdictStoreWriterFromDeploymentEnv(),
            args.row as OutboxRow,
            verdictDeploymentOf(process.env.CONVEX_CLOUD_URL)
        );
    },
});

/** The writer's upload of ONE forwarded resolution (issue #3745). */
export const storeForwardedResolution = internalAction({
    args: { row: v.any() },
    returns: v.union(
        v.object({
            status: v.literal("stored"),
            rowId: v.string(),
            resolutionId: v.string(),
            outcome: putOutcomeValidator,
        }),
        v.object({
            status: v.literal("pending"),
            rowId: v.string(),
            reason: v.string(),
        })
    ),
    handler: async (_ctx, args) => {
        return await storeResolutionRow(
            verdictStoreWriterFromDeploymentEnv(),
            args.row as ResolutionOutboxRow
        );
    },
});
