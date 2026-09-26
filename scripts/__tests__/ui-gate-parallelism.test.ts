// `check:ui`'s viewport parallelism (issue #3653, PRD #3643). Two claims, and
// the second is the one that matters: the count is sized to the MACHINE, and
// nothing a reader sees in the verdict block depends on it.
import { describe, expect, it } from "vitest";
import {
    collectRun,
    CONTEXT_MEMORY_BYTES,
    MAX_PARALLELISM,
    MEMORY_RESERVE_BYTES,
    MIN_PARALLELISM,
    parseParallelOverride,
    RESERVED_CORES,
    runPool,
    viewportParallelism,
    type ViewportResult,
} from "../ui-gate/parallel";
import { VIEWPORT_IDS } from "../ui-gate/viewports";
import type { Measurement } from "../ui-gate/receipt";

const readings = (n: number): Measurement["readings"] =>
    ({ cardsZero: n }) as unknown as Measurement["readings"];

const GIB = 1024 ** 3;

describe("viewportParallelism (issue #3653, re-sized by issue #4687)", () => {
    it("gives the 8-core / 16 GiB machine every viewport at once — the load is not an input", () => {
        expect(viewportParallelism(8, 16 * GIB)).toBe(MAX_PARALLELISM);
        expect(viewportParallelism(16, 64 * GIB)).toBe(MAX_PARALLELISM);
        expect(8 - RESERVED_CORES).toBeGreaterThanOrEqual(MAX_PARALLELISM);
    });

    it("spends the cores past the lane's own reserve", () => {
        expect(viewportParallelism(RESERVED_CORES + 3, 16 * GIB)).toBe(3);
        expect(viewportParallelism(RESERVED_CORES + 4, 16 * GIB)).toBe(4);
    });

    it("never collapses under the floor, however small the machine", () => {
        expect(MIN_PARALLELISM).toBeGreaterThan(1);
        expect(viewportParallelism(1, 16 * GIB)).toBe(MIN_PARALLELISM);
        expect(viewportParallelism(2, 16 * GIB)).toBe(MIN_PARALLELISM);
        expect(viewportParallelism(8, 1 * GIB)).toBe(MIN_PARALLELISM);
    });

    it("caps by memory: one context per budgeted GiB past the reserve", () => {
        const three = MEMORY_RESERVE_BYTES + 3 * CONTEXT_MEMORY_BYTES;
        expect(viewportParallelism(16, three)).toBe(3);
        expect(viewportParallelism(16, three + CONTEXT_MEMORY_BYTES - 1)).toBe(
            3
        );
        expect(viewportParallelism(16, three + CONTEXT_MEMORY_BYTES)).toBe(4);
    });

    it("answers the floor when the machine reports nonsense", () => {
        expect(viewportParallelism(Number.NaN, 16 * GIB)).toBe(MIN_PARALLELISM);
        expect(viewportParallelism(8, Number.NaN)).toBe(MIN_PARALLELISM);
        expect(viewportParallelism(0, 0)).toBe(MIN_PARALLELISM);
    });
});

describe("--parallel=", () => {
    it("takes an integer inside the matrix", () => {
        expect(parseParallelOverride("1")).toBe(1);
        expect(parseParallelOverride(String(MAX_PARALLELISM))).toBe(
            MAX_PARALLELISM
        );
    });

    it("refuses anything else rather than falling back to the sized count", () => {
        for (const raw of ["0", "6", "-1", "2.5", "", "all"]) {
            expect(() => parseParallelOverride(raw)).toThrow(/--parallel=/);
        }
    });
});

describe("runPool", () => {
    it("returns results in ITEM order whatever order they finished in", async () => {
        const delays = [40, 0, 20, 0, 10];
        const out = await runPool(delays, 5, async (ms, i) => {
            await new Promise((r) => setTimeout(r, ms));
            return i;
        });
        expect(out).toEqual([0, 1, 2, 3, 4]);
    });

    it("never runs more than `limit` at once", async () => {
        let live = 0;
        let peak = 0;
        await runPool([1, 2, 3, 4, 5, 6], 2, async () => {
            live += 1;
            peak = Math.max(peak, live);
            await new Promise((r) => setTimeout(r, 5));
            live -= 1;
        });
        expect(peak).toBe(2);
    });

    it("never hands one lane to two tasks at once — the lane owns an account", async () => {
        const busy = new Set<number>();
        const collisions: number[] = [];
        await runPool([30, 0, 10, 0, 20], 2, async (ms, _i, lane) => {
            if (busy.has(lane)) collisions.push(lane);
            busy.add(lane);
            await new Promise((r) => setTimeout(r, ms));
            busy.delete(lane);
            return lane;
        });
        expect(collisions).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The claim `land` depends on: the verdict block is a function of the TREE, not
// of how many contexts the machine could afford.
// ─────────────────────────────────────────────────────────────────────────────

const SURFACES = ["lobby", "deck-builder", "game-board"];

function result(viewport: string, over: Partial<ViewportResult> = {}) {
    return {
        viewport,
        lines: [`  lobby ${viewport} ok`],
        measured: SURFACES.map((surface, i) => ({
            surface,
            readings: readings(i),
        })),
        unreachable: [],
        infra: [],
        consoleErrors: [],
        bandWalks: [],
        ...over,
    } satisfies ViewportResult;
}

function collect(results: readonly ViewportResult[]) {
    return collectRun({
        knownSurfaceIds: SURFACES,
        viewportIds: VIEWPORT_IDS,
        results,
    });
}

describe("collectRun (the receipt cannot tell what N was)", () => {
    it("folds results into viewport order however they arrived", () => {
        const inOrder = VIEWPORT_IDS.map((v) => result(v));
        const shuffled = [
            inOrder[3],
            inOrder[0],
            inOrder[4],
            inOrder[2],
            inOrder[1],
        ];
        expect(collect(shuffled)).toEqual(collect(inOrder));
        for (const walk of collect(shuffled).walks) {
            if (walk.status !== "measured")
                throw new Error("expected measured");
            expect(walk.measurements.map((m) => m.viewport)).toEqual([
                ...VIEWPORT_IDS,
            ]);
        }
    });

    it("keeps a surface unreachable for the RUN, with the first reason in viewport order", () => {
        const results = VIEWPORT_IDS.map((v, i) =>
            i === 0 || i === 2
                ? result(v, {
                      measured: [],
                      unreachable: [
                          { surface: "lobby", reason: `no lobby @ ${v}` },
                      ],
                  })
                : result(v)
        );
        const walks = collect([...results].reverse()).walks;
        expect(walks.find((w) => w.surface === "lobby")).toEqual({
            surface: "lobby",
            status: "unreachable",
            reason: `no lobby @ ${VIEWPORT_IDS[0]}`,
        });
    });

    it("carries every viewport's INFRA cells onto its surface", () => {
        const cell = (viewport: string) => ({
            surface: "game-board",
            cell: {
                viewport,
                signature: "function-timeout" as const,
                load: 9,
                reason: "backend timed out",
            },
        });
        const results = VIEWPORT_IDS.map((v, i) =>
            i < 2 ? result(v, { infra: [cell(v)] }) : result(v)
        );
        const walk = collect([...results].reverse()).walks.find(
            (w) => w.surface === "game-board"
        );
        if (walk?.status !== "measured") throw new Error("expected measured");
        expect(walk.infra?.map((c) => c.viewport)).toEqual([
            VIEWPORT_IDS[0],
            VIEWPORT_IDS[1],
        ]);
    });

    it("prints each viewport's cell lines grouped, in matrix order", () => {
        const results = VIEWPORT_IDS.map((v) =>
            result(v, { lines: [`  a ${v}`, `  b ${v}`] })
        );
        expect(collect([...results].reverse()).lines).toEqual(
            VIEWPORT_IDS.flatMap((v) => [`  a ${v}`, `  b ${v}`])
        );
    });
});
