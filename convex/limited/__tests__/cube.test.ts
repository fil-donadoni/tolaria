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
    maxCubeSeats,
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

describe("maxCubeSeats (ADR 0062 rev: singleton capacity cap)", () => {
    it("is floor(poolSize / (packSize * roundCount)) — the largest singleton table", () => {
        // 283 implemented cards over 3 boosters of 15 → floor(283/45) = 6.
        expect(maxCubeSeats(283, 15, 3)).toBe(6);
        // At exactly 360 the full 8-seat table fits singleton.
        expect(maxCubeSeats(360, 15, 3)).toBe(8);
        // One card short of a boundary rounds down, never up (no repeat).
        expect(maxCubeSeats(359, 15, 3)).toBe(7);
        expect(maxCubeSeats(90, 15, 3)).toBe(2);
        expect(maxCubeSeats(89, 15, 3)).toBe(1);
    });

    it("returns 0 for a degenerate packSize or roundCount (no division by zero)", () => {
        expect(maxCubeSeats(283, 0, 3)).toBe(0);
        expect(maxCubeSeats(283, 15, 0)).toBe(0);
    });

    it("agrees with cubeSampleRegime: a table at the cap is singleton, one above is top-up", () => {
        const pool = 283;
        const cap = maxCubeSeats(pool, 15, 3); // 6
        expect(cubeSampleRegime(pool, cap, 15, 3)).toBe("singleton");
        expect(cubeSampleRegime(pool, cap + 1, 15, 3)).toBe("top-up");
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

    it("THROWS rather than repeating a card when the pool is too small", () => {
        // 2 seats * 15 * 3 = 90 needed, pool only 40. This used to wrap and
        // top the shortfall up WITH-REPLACEMENT, which dealt the same card
        // twice in one draft — "one copy per card, maximum" is a hard
        // invariant, so the deal now refuses instead of degrading quietly.
        const pool = fakePool(40);
        // Round 0 still fits (30 ≤ 40) — the overflow is a LATER round's
        // slice, which is exactly the case the old wrap hid.
        expect(() => dealCubeRoundPacks(pool, 2, 15, 0, 5)).not.toThrow();
        expect(() => dealCubeRoundPacks(pool, 2, 15, 1, 5)).toThrow(
            /singleton/i
        );
    });

    it("THROWS when a single round's slice alone overflows the pool", () => {
        // 8 seats × 15 = 120 > 100 in round 0 — the pathological sub-table
        // case, refused up front rather than dealt with a wrapped cursor.
        expect(() => dealCubeRoundPacks(fakePool(100), 8, 15, 0, 5)).toThrow(
            /cannot deal round 0/
        );
    });

    it("deals every round of a fitting draft with NO card repeated (the invariant the throw protects)", () => {
        // maxCubeSeats(90, 15, 3) === 2, so a 2-seat/3-round draft is exactly
        // fillable from 90 cards: every card dealt once, none twice.
        const pool = fakePool(90);
        const all: string[] = [];
        for (let round = 0; round < 3; round++) {
            for (const pack of dealCubeRoundPacks(pool, 2, 15, round, 5)) {
                all.push(...pack);
            }
        }
        expect(all).toHaveLength(90);
        expect(new Set(all).size).toBe(90);
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
