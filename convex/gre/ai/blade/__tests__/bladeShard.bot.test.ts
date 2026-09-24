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
import { BLADE_SHARDS, bladeShardOf, bladeShardSlice } from "../shard";

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

    it("there is one blade.shard-N.spec.ts per shard, each registering its own index", async () => {
        const dir = __dirname;
        const files = readdirSync(dir)
            .filter((f) => /^blade\.shard-\d+\.spec\.ts$/.test(f))
            .sort();
        expect(files).toEqual(
            Array.from(
                { length: BLADE_SHARDS },
                (_, shard) => `blade.shard-${shard}.spec.ts`
            )
        );
        const { readFileSync } = await import("node:fs");
        files.forEach((file, shard) => {
            expect(readFileSync(path.join(dir, file), "utf8")).toContain(
                `registerBladeShard(${shard});`
            );
        });
    });
});
