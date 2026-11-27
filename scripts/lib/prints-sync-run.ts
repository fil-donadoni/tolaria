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
    /** `--full` (issue #10901): upsert every bucket, ignoring the stored
     *  bucket digests — the by-hand repair of rows edited behind the sync. */
    full: boolean;
}

export function parsePrintsSyncArgs(argv: readonly string[]): PrintsSyncArgs {
    return {
        dryRun: argv.includes("--dry-run"),
        deploy: argv.includes("--deploy"),
        prod: argv.includes("--prod"),
        ifStale: argv.includes("--if-stale"),
        warnOnly: argv.includes("--warn-only"),
        full: argv.includes("--full"),
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

// ── Per-bucket digests (issue #10901) ──────────────────────────────────────
// `--if-stale` still decides on the whole-set digest above whether to
// download at all; once it does, each table's rows are cut into stable
// buckets and only the buckets whose content differs from the digest the
// deployment last recorded are upserted. A one-card change then reads about
// 1/N of `cardPrints` instead of every row (Convex bills each `by_printId`
// lookup in `upsertBatch` as a full document read).

/** Buckets per table: ~50k Card Prints → ~200 rows a bucket, and the stored
 *  digests stay a few hundred tiny rows. Folded into every digest, so a
 *  change of count makes every stored digest stale (a full sync). */
export const PRINTS_SYNC_BUCKET_COUNT = 256;

export type PrintsBucketTable = "cardPrints" | "definitionTokenPrints";

export interface StoredBucketDigest {
    bucket: number;
    digest: string;
}

export interface PrintsBucket<Row> {
    bucket: number;
    digest: string;
    rows: Row[];
}

/** The bucket `key` (a `printId`, or a definition row's `cardId`) falls in:
 *  the first four bytes of its sha256, so it never moves between runs. */
export function bucketOf(
    key: string,
    bucketCount = PRINTS_SYNC_BUCKET_COUNT
): number {
    return (
        createHash("sha256").update(key).digest().readUInt32BE(0) % bucketCount
    );
}

/**
 * Cut `rows` into buckets by `keyOf` and digest each one's content (rows
 * sorted by key, so Scryfall's order never matters). `salt` is folded into
 * every digest: the rarity overrides go there, so an edited override owes
 * every bucket (a full sync), as does a different `bucketCount`. Only
 * non-empty buckets are returned — an empty one has nothing to upsert, and
 * the sync never deletes (ADR 0140 §3).
 */
export function bucketRows<Row>(
    rows: readonly Row[],
    keyOf: (row: Row) => string,
    salt: unknown,
    bucketCount = PRINTS_SYNC_BUCKET_COUNT
): PrintsBucket<Row>[] {
    const byBucket = new Map<number, Row[]>();
    for (const row of rows) {
        const bucket = bucketOf(keyOf(row), bucketCount);
        const list = byBucket.get(bucket);
        if (list) list.push(row);
        else byBucket.set(bucket, [row]);
    }
    const saltJson = JSON.stringify({ salt, bucketCount });
    return [...byBucket.entries()]
        .sort(([a], [b]) => a - b)
        .map(([bucket, list]) => {
            const sorted = [...list].sort((a, b) =>
                keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0
            );
            const hash = createHash("sha256").update(saltJson);
            for (const row of sorted) hash.update(`\n${JSON.stringify(row)}`);
            return { bucket, digest: hash.digest("hex"), rows: sorted };
        });
}

/**
 * The buckets a sync must upsert: every one when the table is empty (its
 * stored digests, if any, describe rows that are gone) or `full` is asked;
 * else each whose digest differs from — or is missing in — `stored`.
 */
export function owedBuckets<Row>(
    local: readonly PrintsBucket<Row>[],
    stored: readonly StoredBucketDigest[],
    tablePopulated: boolean,
    full = false
): PrintsBucket<Row>[] {
    if (!tablePopulated || full) return [...local];
    const storedDigest = new Map(stored.map((s) => [s.bucket, s.digest]));
    return local.filter((b) => storedDigest.get(b.bucket) !== b.digest);
}

/**
 * Group owed buckets into upsert batches of at most `maxRows` rows, never
 * splitting a bucket (a bucket's digest is recorded only once ALL its rows
 * landed); a bucket larger than `maxRows` travels alone.
 */
export function batchBuckets<Row>(
    buckets: readonly PrintsBucket<Row>[],
    maxRows: number
): PrintsBucket<Row>[][] {
    const batches: PrintsBucket<Row>[][] = [];
    let current: PrintsBucket<Row>[] = [];
    let size = 0;
    for (const bucket of buckets) {
        if (current.length > 0 && size + bucket.rows.length > maxRows) {
            batches.push(current);
            current = [];
            size = 0;
        }
        current.push(bucket);
        size += bucket.rows.length;
    }
    if (current.length > 0) batches.push(current);
    return batches;
}
