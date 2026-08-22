import { describe, it, expect } from "vitest";
import { partitionRoundRobin } from "../lib/ladder/pool";

/**
 * Ladder worker pool — partitioning (issue #2681). `partitionRoundRobin` is
 * the pure piece of the parallel dispatch: given N workers it decides which
 * games go to which process. Pinned here so the split stays deterministic
 * and every task is assigned to exactly one bucket.
 */

describe("partitionRoundRobin", () => {
    it("covers every item exactly once, round-robin by index", () => {
        const items = Array.from({ length: 10 }, (_, i) => i);
        const buckets = partitionRoundRobin(items, 3);
        expect(buckets.length).toBe(3);
        expect(buckets[0]).toEqual([0, 3, 6, 9]);
        expect(buckets[1]).toEqual([1, 4, 7]);
        expect(buckets[2]).toEqual([2, 5, 8]);
        expect(buckets.flat().length).toBe(items.length);
        expect(new Set(buckets.flat())).toEqual(new Set(items));
    });

    it("n=1 keeps everything in a single bucket, original order", () => {
        const items = ["a", "b", "c"];
        expect(partitionRoundRobin(items, 1)).toEqual([["a", "b", "c"]]);
    });

    it("n greater than item count leaves trailing buckets empty", () => {
        const items = [1, 2];
        const buckets = partitionRoundRobin(items, 5);
        expect(buckets.length).toBe(5);
        expect(buckets[0]).toEqual([1]);
        expect(buckets[1]).toEqual([2]);
        expect(buckets.slice(2).every((b) => b.length === 0)).toBe(true);
    });

    it("preserves item identity (never clones/reorders within a bucket)", () => {
        const a = { id: 1 };
        const b = { id: 2 };
        const buckets = partitionRoundRobin([a, b], 2);
        expect(buckets[0][0]).toBe(a);
        expect(buckets[1][0]).toBe(b);
    });
});
