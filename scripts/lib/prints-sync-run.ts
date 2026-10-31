/**
 * Pure planning for `bun run prints:sync` (issue #5414, issue #7690): which
 * flags were given, which deployment the write goes to, and whether a
 * deployment already synced against THIS definition set lets the sync stop
 * before the Scryfall download. No I/O, so the test enumerates every branch.
 */

import { createHash } from "node:crypto";
import { resolveSeedTarget, type SeedTargetPlan } from "./seed-preset-run";

export interface PrintsSyncArgs {
    dryRun: boolean;
    /** `--deploy`: the deployment `CONVEX_DEPLOY_KEY` selects (the hosting
     *  build, right after `convex deploy`), not the local one. */
    deploy: boolean;
    /** `--prod`: the production deployment of the project the primary
     *  checkout links, through the Convex CLI login (`seed:preset --prod`'s
     *  target) — the by-hand repair of production, no deploy key needed. */
    prod: boolean;
    /** `--if-stale` (issue #7690): skip the sync when both Token Print tables
     *  have rows AND the last successful sync covered the current definition
     *  set (`syncOwed`). Replaces `--if-empty`, which skipped once the tables
     *  held ANY row, so every card added later never got its Token Prints. */
    ifStale: boolean;
    /** `--warn-only`: a failure prints loudly and exits 0, for chains where a
     *  non-zero exit would block something unrelated (`dev`, a deploy). */
    warnOnly: boolean;
}

export function parsePrintsSyncArgs(argv: readonly string[]): PrintsSyncArgs {
    return {
        dryRun: argv.includes("--dry-run"),
        deploy: argv.includes("--deploy"),
        prod: argv.includes("--prod"),
        ifStale: argv.includes("--if-stale"),
        warnOnly: argv.includes("--warn-only"),
    };
}

export function printsSyncTarget(
    args: PrintsSyncArgs,
    env?: Record<string, string | undefined>
): SeedTargetPlan {
    if (args.deploy && args.prod)
        return { error: "--deploy and --prod are exclusive — pick one target" };
    return resolveSeedTarget(
        args.deploy ? "deployment" : args.prod ? "production" : "local",
        env
    );
}

export interface PrintsPopulated {
    cardPrints: boolean;
    definitionTokenPrints: boolean;
    /** The `definitionSetDigest` the last successful sync recorded, or `null`
     *  (never recorded — a deployment filled before issue #7690). ABSENT when
     *  the deployment still runs functions older than issue #7690. */
    syncedDigest?: string | null;
}

/** Tables a sync would fill, named for the log; empty = nothing owed. */
export function emptyPrintTables(populated: PrintsPopulated): string[] {
    return (["cardPrints", "definitionTokenPrints"] as const).filter(
        (table) => !populated[table]
    );
}

/**
 * The digest of what a sync's rows depend on besides Scryfall (issue #7690):
 * the set of Card IDs it matches printings against (`buildDefinitionIndex`'s
 * values, twin ids already dropped) and the rarity override file. A card
 * added, removed or re-pointed — or an override edited — changes it, so a
 * deployment synced against an older set is stale. Order-insensitive.
 */
export function definitionSetDigest(
    cardIds: Iterable<string>,
    rarityOverrides: unknown
): string {
    const ids = [...new Set(cardIds)].sort();
    return createHash("sha256")
        .update(JSON.stringify({ ids, rarityOverrides }))
        .digest("hex");
}

/**
 * True when the deployment's `cardPrints:populated` predates issue #7690 (no
 * `syncedDigest` key): it has no `recordSync` either, so a sync could never
 * record its digest and every `--if-stale` run would re-download the bulk.
 * The caller skips with a warning until the functions are redeployed.
 */
export function deploymentPredatesSyncState(
    populated: PrintsPopulated
): boolean {
    return populated.syncedDigest === undefined;
}

/**
 * Why `--if-stale` must sync, or `[]` when it may skip (issue #7690): an
 * empty table, a deployment that never recorded a digest, or one recorded
 * against a different definition set.
 */
export function syncOwed(
    populated: PrintsPopulated,
    currentDigest: string
): string[] {
    const reasons = emptyPrintTables(populated).map((t) => `${t} empty`);
    if (populated.syncedDigest == null)
        reasons.push("no sync recorded for any definition set");
    else if (populated.syncedDigest !== currentDigest)
        reasons.push("definition set changed since the last sync");
    return reasons;
}
