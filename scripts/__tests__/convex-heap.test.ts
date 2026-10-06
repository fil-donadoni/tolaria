import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HEALTH_ONLY_GUARDS, HEALTH_SCRIPTS } from "../lib/health-step";
import {
    HEAP_BUDGET_CATALOGUE_BYTES,
    HEAP_BUDGET_NO_CATALOGUE_BYTES,
    bundleModule,
    heapBudgetBytes,
    heapWarnings,
    measureFileHeap,
    reachesCatalogue,
    syntheticPackedCorpus,
} from "../lib/convex-heap";
import { PACKED_CORPUS_PATH, unpackCorpus } from "../lib/packed-corpus";
import type { PackedCorpus } from "../lib/packed-corpus";

/**
 * Issue #4853 (PRD #4849): the heap of one Convex call, measured on `health`.
 * The measurement is pinned against a fixture module whose heap is known — a
 * module holding an N-element array of small integers, 8 B per element in
 * V8 (PACKED_SMI, no pointer compression) — bundled with the CLI's options
 * and imported in a fresh `node --expose-gc`.
 */

const N = 2_000_000;
const EXPECTED_BYTES = N * 8;
const TOLERANCE = 0.25;

let dir: string;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "convex-heap-test-"));
    mkdirSync(join(dir, "convex"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function heapOfArrayModule(n: number): Promise<number> {
    const entry = join(dir, "convex", `array-${n}.ts`);
    writeFileSync(
        entry,
        `export const rows = Array.from({ length: ${n} }, (_, i) => i);\n`
    );
    const out = join(dir, `array-${n}.mjs`);
    await bundleModule(entry, out);
    return measureFileHeap(out, 2);
}

describe("measureFileHeap", () => {
    it("measures a module holding an N-element array within tolerance", async () => {
        const bytes = await heapOfArrayModule(N);
        expect(bytes).toBeGreaterThan(EXPECTED_BYTES * (1 - TOLERANCE));
        expect(bytes).toBeLessThan(EXPECTED_BYTES * (1 + TOLERANCE));
    });

    it("grows with the module: a 2N array reads about twice the heap", async () => {
        const one = await heapOfArrayModule(N);
        const two = await heapOfArrayModule(2 * N);
        expect(two / one).toBeGreaterThan(1.7);
        expect(two / one).toBeLessThan(2.3);
    });
});

describe("synthetic catalogue", () => {
    it("grows the packed corpus to the requested rows with unique ids and names", () => {
        const base = JSON.parse(
            readFileSync(
                resolve(__dirname, "../..", PACKED_CORPUS_PATH),
                "utf8"
            )
        ) as PackedCorpus;
        const target = base.rowCount + 5;
        const grown = JSON.parse(
            syntheticPackedCorpus(base, target)
        ) as PackedCorpus;
        expect(grown.rowCount).toBe(target);
        const rows = unpackCorpus(grown);
        expect(rows).toHaveLength(target);
        expect(new Set(rows.map((r) => r.id)).size).toBe(target);
        expect(new Set(rows.map((r) => r.name)).size).toBe(target);
    });
});

describe("classification and warnings", () => {
    it("a graph reaching the pool or a set reads the catalogue", () => {
        expect(reachesCatalogue(["convex/cards/sets/lea/red.cards.ts"])).toBe(
            true
        );
        expect(reachesCatalogue(["data/catalogue/packed-corpus.json"])).toBe(
            true
        );
        expect(reachesCatalogue(["convex/gameTicks.ts"])).toBe(false);
    });

    it("holds a module to 32 MiB with the catalogue and 4 MiB without", () => {
        expect(heapBudgetBytes(true)).toBe(HEAP_BUDGET_CATALOGUE_BYTES);
        expect(heapBudgetBytes(false)).toBe(HEAP_BUDGET_NO_CATALOGUE_BYTES);
    });

    it("warns for each module over budget at target scale, only", () => {
        const MIB = 1024 * 1024;
        const lines = heapWarnings([
            {
                module: "game.ts",
                readsCatalogue: true,
                todayBytes: 41 * MIB,
                targetBytes: 137 * MIB,
                budgetBytes: heapBudgetBytes(true),
            },
            {
                module: "gameTicks.ts",
                readsCatalogue: false,
                todayBytes: 2 * MIB,
                targetBytes: 2 * MIB,
                budgetBytes: heapBudgetBytes(false),
            },
        ]);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("game.ts");
    });
});

describe("check:convex-heap — the wiring (issue #4853)", () => {
    const pkg = JSON.parse(
        readFileSync(resolve(__dirname, "../../package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    it("is a package script, run by health", () => {
        expect(pkg.scripts["check:convex-heap"]).toBe(
            "bun scripts/check-convex-heap.ts"
        );
        expect(HEALTH_SCRIPTS).toContain("check:convex-heap");
    });

    it("is health-only: no lane gate composes it", () => {
        expect(HEALTH_ONLY_GUARDS).toHaveProperty("check:convex-heap");
        for (const name of ["check:pr", "check:all", "check:all:inner"]) {
            expect(pkg.scripts[name]).not.toContain("check:convex-heap");
        }
    });
});
