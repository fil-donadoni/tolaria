// Bootstrap planning for `prints:sync` (issue #5414, issue #7690): empty or
// stale Card Prints tables make a token render the placeholder, silently.
import { describe, expect, it } from "vitest";
import {
    batchBuckets,
    bucketOf,
    bucketRows,
    definitionSetDigest,
    owedBuckets,
    deploymentPredatesSyncState,
    emptyPrintTables,
    parsePrintsSyncArgs,
    printsSyncTarget,
    syncOwed,
    type PrintsPopulated,
} from "../lib/prints-sync-run";

describe("emptyPrintTables", () => {
    it("names both tables when the deployment is fresh", () => {
        expect(
            emptyPrintTables({
                cardPrints: false,
                definitionTokenPrints: false,
                syncedDigest: null,
            })
        ).toEqual(["cardPrints", "definitionTokenPrints"]);
    });

    it("names only the table still empty", () => {
        expect(
            emptyPrintTables({
                cardPrints: true,
                definitionTokenPrints: false,
                syncedDigest: null,
            })
        ).toEqual(["definitionTokenPrints"]);
    });

    it("owes nothing once both are filled", () => {
        expect(
            emptyPrintTables({
                cardPrints: true,
                definitionTokenPrints: true,
                syncedDigest: null,
            })
        ).toEqual([]);
    });
});

describe("printsSyncTarget", () => {
    it("--deploy without a deploy key is an error, never a local write", () => {
        const plan = printsSyncTarget(
            parsePrintsSyncArgs(["--deploy", "--if-stale"]),
            {}
        );
        expect(plan.error).toMatch(/CONVEX_DEPLOY_KEY/);
        expect(plan.cwd).toBeUndefined();
    });

    it("--deploy with a key selects the deployment with --prod", () => {
        const plan = printsSyncTarget(parsePrintsSyncArgs(["--deploy"]), {
            CONVEX_DEPLOY_KEY: "k",
        });
        expect(plan.flags).toEqual(["--prod"]);
    });

    it("--prod writes production through the CLI login, refusing a stray deploy key", () => {
        expect(
            printsSyncTarget(parsePrintsSyncArgs(["--prod"]), {}).flags
        ).toEqual(["--prod"]);
        expect(
            printsSyncTarget(parsePrintsSyncArgs(["--prod"]), {
                CONVEX_DEPLOY_KEY: "k",
            }).error
        ).toMatch(/CONVEX_DEPLOY_KEY is set/);
    });

    it("--deploy and --prod together is an error", () => {
        const plan = printsSyncTarget(
            parsePrintsSyncArgs(["--deploy", "--prod"]),
            { CONVEX_DEPLOY_KEY: "k" }
        );
        expect(plan.error).toMatch(/exclusive/);
        expect(plan.cwd).toBeUndefined();
    });

    it("no flag targets the local deployment", () => {
        const plan = printsSyncTarget(parsePrintsSyncArgs([]), {});
        expect(plan.flags).toEqual([]);
        expect(plan.error).toBeUndefined();
    });
});

describe("parsePrintsSyncArgs", () => {
    it("reads every flag", () => {
        expect(
            parsePrintsSyncArgs([
                "--dry-run",
                "--if-stale",
                "--warn-only",
                "--full",
            ])
        ).toEqual({
            dryRun: true,
            deploy: false,
            prod: false,
            ifStale: true,
            warnOnly: true,
            full: true,
        });
    });
});

describe("definitionSetDigest (issue #7690)", () => {
    const overrides = { rarityFallback: {}, printOverrides: {} };

    it("ignores order and duplicates", () => {
        expect(definitionSetDigest(["b", "a", "a"], overrides)).toBe(
            definitionSetDigest(["a", "b"], overrides)
        );
    });

    it("changes when a card is added", () => {
        expect(definitionSetDigest(["a", "b", "c"], overrides)).not.toBe(
            definitionSetDigest(["a", "b"], overrides)
        );
    });

    it("changes when a rarity override changes", () => {
        expect(
            definitionSetDigest(["a"], {
                rarityFallback: {},
                printOverrides: { p: "rare" },
            })
        ).not.toBe(definitionSetDigest(["a"], overrides));
    });
});

describe("syncOwed (issue #7690)", () => {
    const filled = (syncedDigest: string | null): PrintsPopulated => ({
        cardPrints: true,
        definitionTokenPrints: true,
        syncedDigest,
    });

    it("skips only when both tables are filled and the digest matches", () => {
        expect(syncOwed(filled("d1"), "d1")).toEqual([]);
    });

    it("owes a sync when a card landed after the tables were filled", () => {
        // The issue #7690 shape: populated tables, Dark Depths added since.
        expect(syncOwed(filled("d1"), "d2")).toEqual([
            "definition set changed since the last sync",
        ]);
    });

    it("owes a sync on a deployment filled before any digest was recorded", () => {
        expect(syncOwed(filled(null), "d1")).toEqual([
            "no sync recorded for any definition set",
        ]);
    });

    it("owes a sync on empty tables whatever the digest", () => {
        expect(
            syncOwed(
                {
                    cardPrints: false,
                    definitionTokenPrints: true,
                    syncedDigest: "d1",
                },
                "d1"
            )
        ).toEqual(["cardPrints empty"]);
    });
});

describe("deploymentPredatesSyncState (issue #7690)", () => {
    it("flags a deployment whose populated() has no syncedDigest key", () => {
        expect(
            deploymentPredatesSyncState({
                cardPrints: true,
                definitionTokenPrints: true,
            })
        ).toBe(true);
    });

    it("a recorded or never-recorded digest is a current deployment", () => {
        for (const syncedDigest of [null, "d1"])
            expect(
                deploymentPredatesSyncState({
                    cardPrints: true,
                    definitionTokenPrints: true,
                    syncedDigest,
                })
            ).toBe(false);
    });
});

// Incremental sync (issue #10901): a one-card change re-upserts only the
// buckets holding that card's printings, not every `cardPrints` row.
describe("per-bucket digests (issue #10901)", () => {
    interface Row {
        printId: string;
        cardId: string;
    }
    const key = (r: Row) => r.printId;
    const printings = (cardId: string, n: number): Row[] =>
        Array.from({ length: n }, (_, i) => ({
            printId: `${cardId}-print-${i}`,
            cardId,
        }));
    const base: Row[] = Array.from({ length: 40 }, (_, c) =>
        printings(`card-${c}`, 5)
    ).flat();
    const salt = { overrides: {} };
    const recorded = (rows: Row[]) =>
        bucketRows(rows, key, salt).map((b) => ({
            bucket: b.bucket,
            digest: b.digest,
        }));

    it("a one-card change owes only the buckets holding its printings", () => {
        const added = printings("new-card", 3);
        const owed = owedBuckets(
            bucketRows([...base, ...added], key, salt),
            recorded(base),
            true
        );
        const expected = new Set(added.map((r) => bucketOf(r.printId)));
        expect(new Set(owed.map((b) => b.bucket))).toEqual(expected);
        expect(owed.length).toBeLessThan(bucketRows(base, key, salt).length);
    });

    it("an unchanged set owes nothing, whatever the row order", () => {
        expect(
            owedBuckets(
                bucketRows([...base].reverse(), key, salt),
                recorded(base),
                true
            )
        ).toEqual([]);
    });

    it("a deployment with no bucket digests owes every bucket", () => {
        const local = bucketRows(base, key, salt);
        expect(owedBuckets(local, [], true)).toEqual(local);
    });

    it("an empty table owes every bucket, even with digests stored", () => {
        const local = bucketRows(base, key, salt);
        expect(owedBuckets(local, recorded(base), false)).toEqual(local);
    });

    it("--full owes every bucket", () => {
        const local = bucketRows(base, key, salt);
        expect(owedBuckets(local, recorded(base), true, true)).toEqual(local);
    });

    it("an edited rarity override owes every bucket (a full sync)", () => {
        const local = bucketRows(base, key, { overrides: { x: "rare" } });
        expect(owedBuckets(local, recorded(base), true)).toEqual(local);
    });

    it("a bucket recorded by an interrupted run is not re-sent; the rest are", () => {
        const local = bucketRows(base, key, salt);
        const half = recorded(base).slice(0, Math.floor(local.length / 2));
        const owed = owedBuckets(local, half, true);
        expect(owed.map((b) => b.bucket)).toEqual(
            local.slice(half.length).map((b) => b.bucket)
        );
    });

    it("batches never split a bucket and stay under the row cap", () => {
        const local = bucketRows(base, key, salt);
        const batches = batchBuckets(local, 12);
        expect(batches.flat()).toEqual(local);
        for (const batch of batches) {
            const size = batch.reduce((n, b) => n + b.rows.length, 0);
            expect(batch.length === 1 || size <= 12).toBe(true);
        }
    });
});
