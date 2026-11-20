/**
 * Blade shard partition (issue #4482, PRD #4480).
 *
 * The four `blade.shard-N.spec.ts` files split the tier by `bladeShardOf`.
 * Nothing else notices a scenario that no shard runs, so this proves the
 * partition over the REAL registry: every entry of every tier lands in exactly
 * one shard, and there is one spec file per shard.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS, bladeScenariosForTier } from "..";
import { robustnessVectors } from "../robustness";
import {
    BLADE_SHARDS,
    bladeShardOf,
    bladeShardSlice,
    costBalancedSlice,
    parseBladePart,
} from "../shard";
import { entrySearchIterations } from "./robustnessShardRunner.helper";

describe("blade shard partition (issue #4482)", () => {
    for (const tier of ["must", "stretch"] as const) {
        it(`${tier} tier: every entry runs in exactly one shard`, () => {
            const entries = bladeScenariosForTier(tier);
            const slices = Array.from({ length: BLADE_SHARDS }, (_, shard) =>
                bladeShardSlice(entries, shard)
            );
            const seen = slices.flat().map((s) => s.label);
            // Exhaustive (nothing dropped) and disjoint (nothing twice).
            expect([...seen].sort()).toEqual(
                entries.map((s) => s.label).sort()
            );
            expect(new Set(seen).size).toBe(entries.length);
        });
    }

    it("the must tier is non-trivial and every shard has work", () => {
        const entries = bladeScenariosForTier("must");
        expect(entries.length).toBeGreaterThanOrEqual(BLADE_SHARDS);
        for (let shard = 0; shard < BLADE_SHARDS; shard++) {
            expect(bladeShardSlice(entries, shard).length).toBeGreaterThan(0);
        }
        expect(BLADE_SCENARIOS.length).toBeGreaterThanOrEqual(entries.length);
    });

    it("shard sizes differ by at most one (index-modulo balance)", () => {
        const entries = bladeScenariosForTier("must");
        const sizes = Array.from(
            { length: BLADE_SHARDS },
            (_, shard) => bladeShardSlice(entries, shard).length
        );
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    });

    it("bladeShardOf stays inside [0, shards)", () => {
        for (let i = 0; i < 50; i++) {
            const shard = bladeShardOf(i);
            expect(shard).toBeGreaterThanOrEqual(0);
            expect(shard).toBeLessThan(BLADE_SHARDS);
        }
    });

    // The robustness audit (issue #4875) shards the same tier through the same
    // partition: a shard file missing there skips its entries silently.
    it.each([
        ["blade", "registerBladeShard"],
        ["robustness", "registerRobustnessShard"],
    ])(
        "there is one %s.shard-N.spec.ts per shard, each registering its own index",
        async (prefix, register) => {
            const dir = __dirname;
            const files = readdirSync(dir)
                .filter((f) =>
                    new RegExp(`^${prefix}\\.shard-\\d+\\.spec\\.ts$`).test(f)
                )
                .sort();
            expect(files).toEqual(
                Array.from(
                    { length: BLADE_SHARDS },
                    (_, shard) => `${prefix}.shard-${shard}.spec.ts`
                )
            );
            const { readFileSync } = await import("node:fs");
            files.forEach((file, shard) => {
                expect(readFileSync(path.join(dir, file), "utf8")).toContain(
                    `${register}(${shard});`
                );
            });
        }
    );
});

// The PR-side robustness audit (issue #10319) splits each shard's slice into
// cost-balanced parts, one CI job per part.
describe("robustness parts (issue #10319)", () => {
    const PARTS = 8;
    const must = bladeScenariosForTier("must");
    const vectors = robustnessVectors().length;
    const cost = (s: (typeof must)[number]) =>
        entrySearchIterations(s, vectors);

    it("every must entry is audited by exactly one (shard, part)", () => {
        const seen: string[] = [];
        for (let shard = 0; shard < BLADE_SHARDS; shard++) {
            const slice = bladeShardSlice(must, shard);
            for (let part = 0; part < PARTS; part++)
                seen.push(
                    ...costBalancedSlice(slice, part, PARTS, cost).map(
                        (s) => s.label
                    )
                );
        }
        expect([...seen].sort()).toEqual(must.map((s) => s.label).sort());
        expect(new Set(seen).size).toBe(must.length);
    });

    it("no part outweighs the mean by more than its heaviest entry", () => {
        for (let shard = 0; shard < BLADE_SHARDS; shard++) {
            const slice = bladeShardSlice(must, shard);
            const total = slice.reduce((n, s) => n + cost(s), 0);
            const heaviest = Math.max(...slice.map(cost));
            for (let part = 0; part < PARTS; part++) {
                const load = costBalancedSlice(slice, part, PARTS, cost).reduce(
                    (n, s) => n + cost(s),
                    0
                );
                expect(load).toBeLessThanOrEqual(total / PARTS + heaviest);
            }
        }
    });

    it("keeps the items' order and balances a skewed list", () => {
        const items = [1, 10, 1, 1, 1, 1, 1, 1, 1, 1, 1];
        expect(costBalancedSlice(items, 0, 2, (n) => n)).toEqual([10]);
        expect(costBalancedSlice(items, 1, 2, (n) => n)).toEqual(
            Array(10).fill(1)
        );
        expect(costBalancedSlice(items, 0, 1, (n) => n)).toEqual(items);
    });

    it("refuses a part outside [0, parts)", () => {
        expect(() => costBalancedSlice([1], 2, 2, (n) => n)).toThrow();
        expect(() => costBalancedSlice([1], 0, 0, (n) => n)).toThrow();
    });

    it("parseBladePart reads i/N and refuses anything else", () => {
        expect(parseBladePart(undefined)).toBeNull();
        expect(parseBladePart("")).toBeNull();
        expect(parseBladePart("3/8")).toEqual({ part: 3, parts: 8 });
        for (const raw of ["8/8", "1/0", "x", "1/", "-1/4", "1.5/4"])
            expect(() => parseBladePart(raw)).toThrow();
    });
});
