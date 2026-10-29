import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    admitByCost,
    buildCostTable,
    medianWalls,
    newestRuns,
    readBotBudget,
    sameCosts,
} from "../lib/bot-test-costs";
import type { FileWall } from "../lib/test-headroom";

/**
 * Issue #6943 — the scoped lanes admit the bot files a diff reaches by
 * MEASURED cost, not by suite. These pin the two decisions the lane reads:
 * the cost table's derivation from health's file walls, and the admission
 * under `laneBotBudget`.
 */
const BUDGET = { perFileMs: 5_000, totalMs: 10_000 };

describe("admitByCost — cheapest first under both budgets", () => {
    it("admits every reached file under the per-file budget while the sum fits", () => {
        const a = admitByCost(
            ["c.bot.test.ts", "a.bot.test.ts", "b.bot.test.ts"],
            {
                "a.bot.test.ts": 300,
                "b.bot.test.ts": 1_200,
                "c.bot.test.ts": 40,
            },
            BUDGET
        );
        expect(a.admitted).toEqual([
            "c.bot.test.ts",
            "a.bot.test.ts",
            "b.bot.test.ts",
        ]);
        expect(a.admittedMs).toBe(1_540);
        expect(a.overFile).toEqual([]);
        expect(a.overTotal).toEqual([]);
        expect(a.unmeasured).toEqual([]);
    });

    it("a file alone over perFileMs is named with its cost, never admitted", () => {
        const a = admitByCost(
            ["blade.bot.test.ts", "census.bot.test.ts"],
            { "blade.bot.test.ts": 45_000, "census.bot.test.ts": 200 },
            BUDGET
        );
        expect(a.admitted).toEqual(["census.bot.test.ts"]);
        expect(a.overFile).toEqual([{ file: "blade.bot.test.ts", ms: 45_000 }]);
    });

    it("past totalMs the dearer files are named; the cheap ones are already in", () => {
        // A hub edit: many reached, the budget decides — cheapest first.
        const costs: Record<string, number> = {};
        const reached: string[] = [];
        for (let i = 0; i < 6; i++) {
            const f = `f${i}.bot.test.ts`;
            costs[f] = 4_000 - i * 600; // f5 cheapest (1000), f0 dearest (4000)
            reached.push(f);
        }
        const a = admitByCost(reached, costs, BUDGET);
        // 1000 + 1600 + 2200 + 2800 = 7600; + 3400 = 11000 > 10000.
        expect(a.admitted).toEqual([
            "f5.bot.test.ts",
            "f4.bot.test.ts",
            "f3.bot.test.ts",
            "f2.bot.test.ts",
        ]);
        expect(a.admittedMs).toBe(7_600);
        expect(a.overTotal.map((x) => x.file)).toEqual([
            "f1.bot.test.ts",
            "f0.bot.test.ts",
        ]);
    });

    it("a file with no measurement is admitted at the presumed perFileMs while the budget has room (issue #6999)", () => {
        const a = admitByCost(["new.bot.test.ts"], {}, BUDGET);
        expect(a.admitted).toEqual(["new.bot.test.ts"]);
        expect(a.presumed).toEqual(["new.bot.test.ts"]);
        expect(a.admittedMs).toBe(BUDGET.perFileMs);
        expect(a.unmeasured).toEqual([]);
    });

    it("measured files are admitted before any unmeasured one, whatever the paths", () => {
        const a = admitByCost(
            ["a-new.bot.test.ts", "z-old.bot.test.ts"],
            { "z-old.bot.test.ts": 4_000 },
            BUDGET
        );
        expect(a.admitted).toEqual(["z-old.bot.test.ts", "a-new.bot.test.ts"]);
        expect(a.presumed).toEqual(["a-new.bot.test.ts"]);
    });

    it("a full budget of measured files names the unmeasured one — never drops it", () => {
        const a = admitByCost(
            ["new.bot.test.ts", "a.bot.test.ts", "b.bot.test.ts"],
            { "a.bot.test.ts": 4_900, "b.bot.test.ts": 4_900 },
            BUDGET
        );
        expect(a.admitted).toEqual(["a.bot.test.ts", "b.bot.test.ts"]);
        expect(a.presumed).toEqual([]);
        expect(a.unmeasured).toEqual(["new.bot.test.ts"]);
    });

    it("unmeasured files are admitted by path until the presumed costs fill totalMs", () => {
        const a = admitByCost(
            ["c.bot.test.ts", "a.bot.test.ts", "b.bot.test.ts"],
            {},
            BUDGET
        );
        // 2 × 5 s = 10 s = totalMs; the third has no room.
        expect(a.presumed).toEqual(["a.bot.test.ts", "b.bot.test.ts"]);
        expect(a.unmeasured).toEqual(["c.bot.test.ts"]);
    });
});

describe("the refresh's change test (issue #6999)", () => {
    it("sameCosts compares rows, not provenance", () => {
        const runs = [{ dir: "/d/aaa", walls: [wall("a", 10)] }];
        const table = buildCostTable(runs);
        expect(table.source).toEqual(["aaa"]);
        expect(sameCosts(table.files, { a: 10 })).toBe(true);
        expect(sameCosts(table.files, { a: 11 })).toBe(false);
        expect(sameCosts(table.files, { a: 10, b: 1 })).toBe(false);
        expect(sameCosts({ a: 10, b: 1 }, { a: 10, c: 1 })).toBe(false);
    });
});

const wall = (file: string, wallMs: number, state = "passed"): FileWall => ({
    file,
    project: "bot-node",
    wallMs,
    state,
});

describe("medianWalls — the cost table from health's file walls", () => {
    it("the median across runs, per file", () => {
        expect(
            medianWalls([
                [wall("a", 100), wall("b", 10)],
                [wall("a", 300)],
                [wall("a", 200), wall("b", 30)],
            ])
        ).toEqual({ a: 200, b: 20 });
    });

    it("a failed run of a file measures the failure, not the cost", () => {
        expect(
            medianWalls([[wall("a", 60_000, "failed")], [wall("a", 400)]])
        ).toEqual({ a: 400 });
    });

    it("a file a retry re-ran counts at its worst passed wall in that run", () => {
        expect(medianWalls([[wall("a", 100), wall("a", 900)]])).toEqual({
            a: 900,
        });
    });
});

describe("newestRuns — sealed runs with file walls, newest first", () => {
    let root: string | null = null;
    afterEach(() => {
        if (root) rmSync(root, { recursive: true, force: true });
        root = null;
    });

    const run = (
        name: string,
        ts: number | null,
        files: FileWall[] | undefined
    ) => {
        const dir = join(root!, name);
        mkdirSync(dir, { recursive: true });
        if (ts !== null)
            writeFileSync(join(dir, "run.json"), JSON.stringify({ ts }));
        writeFileSync(
            join(dir, "1-1.json"),
            JSON.stringify({ version: 1, records: [], files })
        );
    };

    it("skips unsealed runs and runs written before file walls existed", () => {
        root = mkdtempSync(join(tmpdir(), "bot-costs-"));
        run("old", 100, [wall("a", 1)]);
        run("mid", 200, [wall("a", 2)]);
        run("pre6943", 300, undefined);
        run("live", null, [wall("a", 3)]);
        run("new", 400, [wall("a", 4)]);
        const runs = newestRuns(root, 2);
        expect(runs.map((r) => r.dir.split("/").pop())).toEqual(["new", "mid"]);
    });
});

describe("readBotBudget — config, never a literal", () => {
    it("the committed tolaria.config.json carries a well-formed laneBotBudget", () => {
        const b = readBotBudget(join(__dirname, "..", ".."));
        expect(b.perFileMs).toBeGreaterThan(0);
        expect(b.totalMs).toBeGreaterThanOrEqual(b.perFileMs);
        expect(b.medianOfRuns).toBeGreaterThan(0);
    });
});
