import { describe, it, expect } from "vitest";

import { computeTrainOrder } from "../lib/train-order";
import {
    parseReceipt,
    RECEIPT_VERSION,
    type WorkReceipt,
} from "../lib/receipt";

/**
 * Merge-train order from the receipt conflict graph (issue #2185, PRD #2180).
 *
 * Every fixture goes through `parseReceipt`, not a hand-built object literal.
 * The ordering function's whole input is the receipt contract, so a test that
 * fabricated receipts the validator would reject would be asserting order for
 * a batch that can never reach the train.
 */

function receipt(
    issue: number,
    targetFiles: string[],
    restructures?: string[]
): WorkReceipt {
    return parseReceipt({
        version: RECEIPT_VERSION,
        role: "implement",
        issue,
        outcome: "pr-open",
        pr: 9000 + issue,
        branch: `feat/issue-${issue}`,
        worktree: `/tmp/tolaria-${issue}`,
        targetFiles,
        ...(restructures ? { restructures } : {}),
        proofOfFailure: [],
    }) as WorkReceipt;
}

describe("a batch the conflict graph has nothing to say about", () => {
    it("preserves the incoming priority order for fully disjoint PRs", () => {
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts"]),
            receipt(20, ["src/components/board/Hand.tsx"]),
            receipt(30, ["scripts/gate.ts"]),
        ]);
        expect(result.order).toEqual([10, 20, 30]);
        expect(result.edges).toEqual([]);
        expect(result.cycles).toEqual([]);
    });

    it("preserves priority when two PRs share a file but neither restructures it", () => {
        // Both merely edit `layers.ts`. The train re-gates every merge against
        // the real post-merge main, so an ordering constraint here would buy
        // nothing and serialise a batch that had no reason to be.
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts"]),
            receipt(20, ["convex/gre/layers.ts"]),
        ]);
        expect(result.order).toEqual([10, 20]);
        expect(result.edges).toEqual([]);
    });

    it("ignores receipts with nothing to merge", () => {
        const wip = parseReceipt({
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 20,
            outcome: "wip",
            branch: "feat/issue-20",
            worktree: "/tmp/tolaria-20",
            targetFiles: ["convex/gre/layers.ts"],
            proofOfFailure: [],
            reason: "still red",
        }) as WorkReceipt;

        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts"], ["convex/gre/layers.ts"]),
            wip,
        ]);
        // #20 is not in the train, so it neither merges nor constrains it.
        expect(result.order).toEqual([10]);
        expect(result.edges).toEqual([]);
    });
});

describe("one-way overlap — the restructuring PR lands first", () => {
    it("orders the restructurer ahead of the PR that merely touches the file", () => {
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts"]),
            receipt(20, ["convex/gre/layers.ts"], ["convex/gre/layers.ts"]),
        ]);
        expect(result.order).toEqual([20, 10]);
        expect(result.edges).toEqual([
            { before: 20, after: 10, path: "convex/gre/layers.ts" },
        ]);
    });

    it("overrides incoming priority — the constraint outranks bugs-first", () => {
        // #10 is the higher-priority issue and still merges second. Priority
        // decides ties; it does not decide correctness.
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts", "src/lib/card-utils.ts"]),
            receipt(20, ["convex/gre/layers.ts"], ["convex/gre/layers.ts"]),
        ]);
        expect(result.order).toEqual([20, 10]);
    });

    it("chains transitively across three PRs", () => {
        const result = computeTrainOrder([
            receipt(10, ["a.ts"]),
            receipt(20, ["a.ts", "b.ts"], ["a.ts"]),
            receipt(30, ["b.ts"], ["b.ts"]),
        ]);
        // 30 restructures b.ts (which 20 touches) → 30 before 20;
        // 20 restructures a.ts (which 10 touches) → 20 before 10.
        expect(result.order).toEqual([30, 20, 10]);
    });

    it("keeps priority among PRs the constraint does not relate", () => {
        const result = computeTrainOrder([
            receipt(10, ["a.ts"]),
            receipt(20, ["z.ts"]),
            receipt(30, ["a.ts"], ["a.ts"]),
        ]);
        // The ONLY constraint is 30 before 10. #20 conflicts with neither, so
        // it keeps its priority slot and merges first — the constraint pulls 30
        // ahead of 10, it does not pull 30 ahead of the whole batch.
        expect(result.order).toEqual([20, 30, 10]);
        expect(result.order.indexOf(30)).toBeLessThan(result.order.indexOf(10));
    });

    it("treats a directory restructure as covering the files under it", () => {
        const result = computeTrainOrder([
            receipt(10, ["src/components/board/Hand.tsx"]),
            receipt(
                20,
                ["src/components/board", "src/components/board/Hand.tsx"],
                ["src/components/board"]
            ),
        ]);
        expect(result.order).toEqual([20, 10]);
    });
});

describe("append-only registration points create no edges", () => {
    it("does not order two card PRs that both touch the card index", () => {
        const result = computeTrainOrder([
            receipt(10, [
                "convex/cards/sets/lea/red.ts",
                "convex/cards/index.ts",
            ]),
            receipt(
                20,
                ["convex/cards/sets/lea/blue.ts", "convex/cards/index.ts"],
                ["convex/cards/index.ts"]
            ),
        ]);
        // Even declared as restructured, a registration point is excluded: the
        // train absorbs its trivial rebase conflict by design, and an edge here
        // would serialise every batch that ships a card.
        expect(result.edges).toEqual([]);
        expect(result.order).toEqual([10, 20]);
    });

    it("still orders on a genuine shared file in the same batch", () => {
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts", "convex/cards/index.ts"]),
            receipt(
                20,
                ["convex/gre/layers.ts", "convex/cards/index.ts"],
                ["convex/gre/layers.ts"]
            ),
        ]);
        expect(result.order).toEqual([20, 10]);
        expect(result.edges).toEqual([
            { before: 20, after: 10, path: "convex/gre/layers.ts" },
        ]);
    });

    it("honours an overridden append-only list", () => {
        const result = computeTrainOrder(
            [
                receipt(10, ["data/pick-ratings/vintage-cube.json"]),
                receipt(
                    20,
                    ["data/pick-ratings/vintage-cube.json"],
                    ["data/pick-ratings/vintage-cube.json"]
                ),
            ],
            { appendOnlyPaths: ["data/pick-ratings/vintage-cube.json"] }
        );
        expect(result.edges).toEqual([]);
    });
});

describe("a genuine cycle is reported, not broken", () => {
    it("reports two PRs that both restructure the same file", () => {
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts"], ["convex/gre/layers.ts"]),
            receipt(20, ["convex/gre/layers.ts"], ["convex/gre/layers.ts"]),
        ]);
        expect(result.cycles).toEqual([
            { issues: [10, 20], paths: ["convex/gre/layers.ts"] },
        ]);
        // Empty, not "best effort". A plausible order here would be a merge
        // sequence nobody chose and nobody could reconstruct afterwards.
        expect(result.order).toEqual([]);
    });

    it("reports a three-PR cycle no pairwise check can see", () => {
        const result = computeTrainOrder([
            receipt(10, ["a.ts", "c.ts"], ["a.ts"]),
            receipt(20, ["a.ts", "b.ts"], ["b.ts"]),
            receipt(30, ["b.ts", "c.ts"], ["c.ts"]),
        ]);
        // 10→20 (a.ts), 20→30 (b.ts), 30→10 (c.ts). Every pair is a clean
        // one-way overlap; only the traversal sees the loop.
        expect(result.cycles).toHaveLength(1);
        expect(result.cycles[0].issues).toEqual([10, 20, 30]);
        expect(result.cycles[0].paths).toEqual(["a.ts", "b.ts", "c.ts"]);
        expect(result.order).toEqual([]);
    });

    it("does not report a cycle for a diamond", () => {
        // 10 before 20 and 30; both before 40. Four PRs, four edges, no loop.
        const result = computeTrainOrder([
            receipt(10, ["a.ts", "b.ts"], ["a.ts", "b.ts"]),
            receipt(20, ["a.ts", "c.ts"], ["c.ts"]),
            receipt(30, ["b.ts", "d.ts"], ["d.ts"]),
            receipt(40, ["c.ts", "d.ts"]),
        ]);
        expect(result.cycles).toEqual([]);
        expect(result.order[0]).toBe(10);
        expect(result.order[3]).toBe(40);
        expect(result.order).toHaveLength(4);
    });
});

describe("the receipt contract carries the restructure claim", () => {
    it("rejects a restructured path that is not in the diff", () => {
        expect(() => receipt(10, ["a.ts"], ["b.ts"])).toThrow(
            /restructures: not a subset of targetFiles: b\.ts/
        );
    });

    it("accepts a receipt with no restructure claim at all", () => {
        expect(receipt(10, ["a.ts"]).restructures).toBeUndefined();
    });
});
