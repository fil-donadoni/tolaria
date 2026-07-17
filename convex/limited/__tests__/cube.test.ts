// Vintage Cube pool-as-source tests (ADR 0062). A cube is a curated POOL, not
// a set: no print sheets, no completeness gate. These cover the pure sampling
// core (pool builder over the implemented subset, seeded singleton dealing,
// with-replacement top-up when the pool is too small) and the deliberate gate
// bypass at the registry seam. Pure functions, no convex-test harness — same
// discipline as `draftEngine.test.ts` / `eventLogic.test.ts`.
import { describe, it, expect } from "vitest";
import {
    CUBE_SOURCE_KEY,
    CUBE_PACK_SIZE,
    CUBE_CARD_NAMES,
    isCubeSource,
    buildCubePool,
    cubePoolSize,
    cubeSampleRegime,
    shuffleCube,
    dealCubeRoundPacks,
} from "../cube";
import { isDraftableSet, listDraftableSets } from "../registry";
import { tryGetCardByName, tryGetDefinition } from "../../cards";

describe("isCubeSource (ADR 0062)", () => {
    it("matches the reserved cube key case-insensitively, nothing else", () => {
        expect(isCubeSource(CUBE_SOURCE_KEY)).toBe(true);
        expect(isCubeSource("Vintage-Cube")).toBe(true);
        expect(isCubeSource("VINTAGE-CUBE")).toBe(true);
        expect(isCubeSource("lea")).toBe(false);
        expect(isCubeSource("cube")).toBe(false);
    });
});

describe("cube names data (derived from the canonical worklist)", () => {
    it("is a clean, deduplicated, non-empty list of names", () => {
        expect(CUBE_CARD_NAMES.length).toBeGreaterThan(0);
        // No blanks and no case-insensitive duplicates — the same normalization
        // the generator applies to data/worklists/vintage-cube.txt.
        const keys = new Set<string>();
        for (const name of CUBE_CARD_NAMES) {
            expect(name.trim()).toBe(name);
            expect(name.length).toBeGreaterThan(0);
            const key = name.toLowerCase();
            expect(keys.has(key)).toBe(false);
            keys.add(key);
        }
    });
});

describe("buildCubePool (ADR 0062: implemented subset of the cube list)", () => {
    it("keeps ONLY names that resolve to an implemented CardDefinition", () => {
        const pool = buildCubePool();
        // Every id in the pool resolves to an implemented definition.
        for (const id of pool) {
            expect(tryGetDefinition(id)).not.toBeNull();
        }
        // Its size equals the independently-computed implemented-name count —
        // the exact "names ∩ implemented" contract, robust to which specific
        // cards are implemented over time.
        const expected = new Set<string>();
        for (const name of CUBE_CARD_NAMES) {
            const def = tryGetCardByName(name);
            if (def) expected.add(def.id);
        }
        expect(pool.length).toBe(expected.size);
        expect(new Set(pool)).toEqual(expected);
    });

    it("drops unimplemented cube names (pool is a strict subset of the list)", () => {
        // Some cube names are not implemented yet — the pool must be smaller
        // than the full list, proving the filter actually drops them.
        expect(buildCubePool().length).toBeLessThan(CUBE_CARD_NAMES.length);
    });

    it("includes a canonical always-implemented cube card (Black Lotus)", () => {
        const lotus = tryGetCardByName("Black Lotus");
        expect(lotus).not.toBeNull();
        expect(buildCubePool()).toContain(lotus!.id);
    });

    it("is deduplicated by id and matches cubePoolSize()", () => {
        const pool = buildCubePool();
        expect(new Set(pool).size).toBe(pool.length);
        expect(cubePoolSize()).toBe(pool.length);
    });
});

describe("cubeSampleRegime (ADR 0062)", () => {
    it("is singleton exactly when the pool covers seats*pack*rounds", () => {
        // 8 seats * 15 * 3 = 360 needed.
        expect(cubeSampleRegime(360, 8, 15, 3)).toBe("singleton");
        expect(cubeSampleRegime(361, 8, 15, 3)).toBe("singleton");
        expect(cubeSampleRegime(359, 8, 15, 3)).toBe("top-up");
        // 2 seats * 15 * 3 = 90 needed.
        expect(cubeSampleRegime(90, 2, 15, 3)).toBe("singleton");
        expect(cubeSampleRegime(89, 2, 15, 3)).toBe("top-up");
    });
});

// A synthetic pool of distinct ids, decoupled from the live registry so the
// sampling invariants are exercised at exact boundary sizes.
function fakePool(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `card-${i}`);
}

describe("shuffleCube (seeded, deterministic)", () => {
    it("is a permutation and reproducible for the same (pool, seed)", () => {
        const pool = fakePool(50);
        const a = shuffleCube(pool, 123);
        const b = shuffleCube(pool, 123);
        expect(a).toEqual(b);
        expect([...a].sort()).toEqual([...pool].sort()); // permutation
        expect(a).not.toBe(pool); // does not mutate the input
    });

    it("differs for different seeds", () => {
        const pool = fakePool(50);
        expect(shuffleCube(pool, 1)).not.toEqual(shuffleCube(pool, 2));
    });
});

describe("dealCubeRoundPacks (ADR 0062)", () => {
    it("deals seatCount packs of exactly CUBE_PACK_SIZE cards", () => {
        const packs = dealCubeRoundPacks(
            fakePool(400),
            8,
            CUBE_PACK_SIZE,
            0,
            7
        );
        expect(packs).toHaveLength(8);
        for (const p of packs) expect(p).toHaveLength(CUBE_PACK_SIZE);
    });

    it("is deterministic given a fixed seed", () => {
        const pool = fakePool(400);
        expect(dealCubeRoundPacks(pool, 8, 15, 0, 42)).toEqual(
            dealCubeRoundPacks(pool, 8, 15, 0, 42)
        );
    });

    it("is SINGLETON across the whole draft when the pool covers it", () => {
        // 8 seats * 15 * 3 rounds = 360 ≤ 400: no card appears twice across
        // any pack of any round.
        const pool = fakePool(400);
        const all: string[] = [];
        for (let round = 0; round < 3; round++) {
            for (const pack of dealCubeRoundPacks(pool, 8, 15, round, 99)) {
                all.push(...pack);
            }
        }
        expect(all).toHaveLength(360);
        expect(new Set(all).size).toBe(360); // all distinct
    });

    it("tops up WITH-REPLACEMENT when the pool is too small (never blocks)", () => {
        // 2 seats * 15 * 3 = 90 needed, pool only 40 → cards must repeat.
        const pool = fakePool(40);
        const all: string[] = [];
        for (let round = 0; round < 3; round++) {
            for (const pack of dealCubeRoundPacks(pool, 2, 15, round, 5)) {
                all.push(...pack);
            }
        }
        expect(all).toHaveLength(90);
        // Fewer distinct than dealt — the shortfall was topped up by reuse.
        expect(new Set(all).size).toBeLessThan(90);
        // Every dealt card is still a real pool card (no phantom/placeholder).
        for (const id of all) expect(pool).toContain(id);
    });

    it("throws only on a genuinely empty pool", () => {
        expect(() => dealCubeRoundPacks([], 2, 15, 0, 1)).toThrow(/empty/);
    });

    it("deals the live implemented pool into 15-card packs", () => {
        const pool = buildCubePool();
        const packs = dealCubeRoundPacks(pool, 8, CUBE_PACK_SIZE, 0, 1);
        expect(packs).toHaveLength(8);
        for (const p of packs) expect(p).toHaveLength(CUBE_PACK_SIZE);
    });
});

describe("gate bypass at the registry seam (ADR 0062)", () => {
    it("isDraftableSet is ALWAYS true for the cube (no ≥80% gate)", () => {
        expect(isDraftableSet(CUBE_SOURCE_KEY)).toBe(true);
        expect(isDraftableSet("VINTAGE-CUBE")).toBe(true);
    });

    it("listDraftableSets exposes the cube as a selectable pool source", () => {
        const cube = listDraftableSets().find(
            (s) => s.setCode === CUBE_SOURCE_KEY
        );
        expect(cube).toBeDefined();
        expect(cube!.draftable).toBe(true);
        expect(cube!.isCube).toBe(true);
        expect(cube!.missingCardCount).toBe(0); // never a "missing" disable
        expect(cube!.availableCardCount).toBe(cubePoolSize());
        expect(cube!.availableCardCount).toBeGreaterThan(0);
    });
});
