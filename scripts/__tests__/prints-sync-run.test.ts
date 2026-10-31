// Bootstrap planning for `prints:sync` (issue #5414, issue #7690): empty or
// stale Card Prints tables make a token render the placeholder, silently.
import { describe, expect, it } from "vitest";
import {
    definitionSetDigest,
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
            parsePrintsSyncArgs(["--dry-run", "--if-stale", "--warn-only"])
        ).toEqual({
            dryRun: true,
            deploy: false,
            prod: false,
            ifStale: true,
            warnOnly: true,
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
