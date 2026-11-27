import { describe, expect, it } from "vitest";
import {
    DEFAULT_CENSUS_SEED,
    buildCensusJobs,
    censusReadings,
    censusVerdicts,
    diffCensus,
    formatCensusSummary,
    lineCensusSummaries,
    mergeCensusResults,
    parseSlice,
    selectCensusEntries,
    sliceCensusJobs,
    withCensusReadings,
    type CensusEntry,
    type CensusLineDecision,
    type CensusMeta,
    type CensusResult,
    type CensusRow,
} from "../census";

const ENTRIES: CensusEntry[] = [
    {
        label: "cheap a",
        tier: "must",
        budget: { iterations: 200 },
        seeds: [1, 2],
    },
    {
        label: "costly b",
        tier: "must",
        budget: { iterations: 1000 },
        seeds: [1, 2, 3],
    },
    { label: "default seed c", tier: "must", budget: { iterations: 400 } },
    {
        label: "stretch d",
        tier: "stretch",
        budget: { iterations: 5000 },
        seeds: [1],
    },
];

function meta(over: Partial<CensusMeta> = {}): CensusMeta {
    return {
        tier: "must",
        variant: null,
        match: null,
        iterations: null,
        failFast: false,
        slices: ["1/1"],
        jobs: 0,
        wallMs: 0,
        cpuMs: 0,
        workers: 1,
        sha: null,
        ...over,
    };
}

function row(
    id: number,
    label: string,
    seed: number,
    ok: boolean,
    over: Partial<CensusRow> = {}
): CensusRow {
    return {
        id,
        label,
        seed,
        iterations: 400,
        ok,
        move: ok ? "pass" : "cast-spell",
        reason: ok ? "" : "wrong",
        mechanism: null,
        ms: 10,
        ...over,
    };
}

describe("blade census — selection and job list", () => {
    it("selects the tier, then the exact labels, then the regex", () => {
        const must = selectCensusEntries(ENTRIES, { tier: "must" });
        expect(must.map((e) => e.label)).toEqual([
            "cheap a",
            "costly b",
            "default seed c",
        ]);
        const exact = selectCensusEntries(ENTRIES, {
            tier: "must",
            entries: ["costly b"],
        });
        expect(exact.map((e) => e.label)).toEqual(["costly b"]);
        const re = selectCensusEntries(ENTRIES, { tier: "must", match: "^c" });
        expect(re.map((e) => e.label)).toEqual(["cheap a", "costly b"]);
    });

    it("refuses an exact label the tier does not hold", () => {
        expect(() =>
            selectCensusEntries(ENTRIES, {
                tier: "must",
                entries: ["stretch d"],
            })
        ).toThrow(/no must entry labelled "stretch d"/);
    });

    it("lists one job per (entry, seed), costliest budget first, ids in that order", () => {
        const config = { tier: "must" as const };
        const jobs = buildCensusJobs(
            selectCensusEntries(ENTRIES, config),
            config
        );
        expect(jobs.map((j) => [j.id, j.label, j.seed, j.iterations])).toEqual([
            [0, "costly b", 1, 1000],
            [1, "costly b", 2, 1000],
            [2, "costly b", 3, 1000],
            [3, "default seed c", DEFAULT_CENSUS_SEED, 400],
            [4, "cheap a", 1, 200],
            [5, "cheap a", 2, 200],
        ]);
    });

    it("overrides every budget with --iterations", () => {
        const config = { tier: "must" as const, iterations: 2000 };
        const jobs = buildCensusJobs(
            selectCensusEntries(ENTRIES, config),
            config
        );
        expect(new Set(jobs.map((j) => j.iterations))).toEqual(new Set([2000]));
    });

    it("refuses an entry that declares an empty seed list, as the runner does", () => {
        const empty = [
            {
                label: "no seeds",
                tier: "must",
                budget: { iterations: 100 },
                seeds: [],
            },
        ];
        expect(() => buildCensusJobs(empty, { tier: "must" })).toThrow(
            /empty seed list/
        );
    });

    it("partitions the job list into disjoint, exhaustive slices", () => {
        const config = { tier: "must" as const };
        const jobs = buildCensusJobs(
            selectCensusEntries(ENTRIES, config),
            config
        );
        const slices = [1, 2, 3, 4].map((index) =>
            sliceCensusJobs(jobs, { index, count: 4 }).map((j) => j.id)
        );
        expect(slices.flat().sort((a, b) => a - b)).toEqual(
            jobs.map((j) => j.id)
        );
        expect(slices[0]).toEqual([0, 4]);
    });

    it("parses i/n and refuses an out-of-range slice", () => {
        expect(parseSlice("3/8")).toEqual({ index: 3, count: 8 });
        expect(() => parseSlice("0/8")).toThrow();
        expect(() => parseSlice("9/8")).toThrow();
        expect(() => parseSlice("3-8")).toThrow();
    });
});

describe("blade census — verdicts, merge, diff", () => {
    it("reds an entry on any red seed and ignores fail-fast skips", () => {
        const verdicts = censusVerdicts([
            row(0, "x", 1, true),
            row(1, "x", 2, false),
            row(2, "x", 3, true, { skipped: true, ms: 0 }),
            row(3, "y", 1, true),
        ]);
        expect(verdicts.map((v) => [v.label, v.ok, v.redSeeds])).toEqual([
            ["x", false, [2]],
            ["y", true, []],
        ]);
    });

    it("merges slices and refuses a duplicate job or a mismatched arm", () => {
        const a: CensusResult = {
            meta: meta({ slices: ["1/2"], jobs: 1, wallMs: 5, cpuMs: 10 }),
            rows: [row(0, "x", 1, true)],
        };
        const b: CensusResult = {
            meta: meta({ slices: ["2/2"], jobs: 1, wallMs: 7, cpuMs: 10 }),
            rows: [row(1, "x", 2, true)],
        };
        const merged = mergeCensusResults([b, a]);
        expect(merged.rows.map((r) => r.id)).toEqual([0, 1]);
        expect(merged.meta).toMatchObject({
            jobs: 2,
            wallMs: 7,
            cpuMs: 20,
            slices: ["2/2", "1/2"],
        });
        expect(() => mergeCensusResults([a, a])).toThrow(/appears twice/);
        const other: CensusResult = {
            meta: meta({ variant: "no-tie-margin" }),
            rows: [row(1, "x", 2, true)],
        };
        expect(() => mergeCensusResults([a, other])).toThrow(
            /disagree on variant/
        );
        const screened: CensusResult = {
            meta: meta({ failFast: true }),
            rows: [row(1, "x", 2, true)],
        };
        expect(() => mergeCensusResults([a, screened])).toThrow(
            /disagree on failFast/
        );
    });

    it("reports new reds, fixes, standing reds and unmatched entries", () => {
        const base: CensusResult = {
            meta: meta(),
            rows: [
                row(0, "flips red", 1, true),
                row(1, "fixed", 1, false),
                row(2, "both", 1, false),
                row(3, "base only", 1, true),
            ],
        };
        const variant: CensusResult = {
            meta: meta({ variant: "v" }),
            rows: [
                row(0, "flips red", 1, false),
                row(1, "fixed", 1, true),
                row(2, "both", 1, false),
                row(4, "variant only", 1, true),
            ],
        };
        const diff = diffCensus(base, variant);
        expect(diff.newReds.map((f) => [f.label, f.redSeeds])).toEqual([
            ["flips red", [1]],
        ]);
        expect(diff.fixed.map((f) => f.label)).toEqual(["fixed"]);
        expect(diff.stillRed.map((f) => f.label)).toEqual(["both"]);
        expect(diff.unmatched.sort()).toEqual([
            "base only @400",
            "variant only @400",
        ]);
    });

    it("finds no flip between an arm and itself", () => {
        const arm: CensusResult = {
            meta: meta(),
            rows: [row(0, "x", 1, true), row(1, "y", 1, false)],
        };
        const diff = diffCensus(arm, arm);
        expect(diff.newReds).toEqual([]);
        expect(diff.fixed).toEqual([]);
    });
});

describe("blade census — correctness, performance, saturation", () => {
    // One row per quadrant at least, a row exactly AT the threshold (under:
    // only strictly above is over), and a fail-fast skip no reading counts.
    const ROWS: CensusRow[] = [
        row(0, "green fast", 1, true, { ms: 1000, iterations: 1000 }),
        row(1, "green fast", 2, true, { ms: 5000, iterations: 1000 }),
        row(2, "green slow", 1, true, { ms: 9000, iterations: 1000 }),
        row(3, "red fast", 1, false, { ms: 2000, iterations: 500 }),
        row(4, "red fast", 2, true, { ms: 0, iterations: 500, skipped: true }),
        row(5, "red slow", 1, false, { ms: 6000, iterations: 2000 }),
        row(6, "red slow", 2, false, { ms: 8000, iterations: 2000 }),
    ];

    it("counts each quadrant of (green, red) x (under, over) the threshold", () => {
        const r = censusReadings(ROWS, 5000);
        expect(r.saturation).toEqual({
            greenUnder: 2,
            greenOver: 1,
            redUnder: 1,
            redOver: 2,
        });
        expect(r.performance.overThreshold).toBe(3);
        expect(r.correctness).toEqual({
            entries: 4,
            redEntries: 2,
            rows: 6,
            redRows: 3,
        });
    });

    it("moves rows between quadrants with the threshold, never their verdict", () => {
        const r = censusReadings(ROWS, 1500);
        expect(r.saturation).toEqual({
            greenUnder: 1,
            greenOver: 2,
            redUnder: 0,
            redOver: 3,
        });
        expect(r.correctness.redRows).toBe(3);
    });

    it("reads the time and ms-per-iteration distributions of the searches run", () => {
        const r = censusReadings(ROWS, 5000);
        // ms of the six searches run: 1000 2000 5000 6000 8000 9000.
        expect(r.performance.ms).toEqual({
            p50: 5000,
            p90: 9000,
            p99: 9000,
            max: 9000,
            mean: 31000 / 6,
        });
        // ms per iteration: 1 3 4 4 5 9.
        expect(r.performance.msPerIteration).toMatchObject({
            p50: 4,
            max: 9,
        });
    });

    it("prints the three readings and the lab-proxy note in the summary", () => {
        const arm = withCensusReadings({ meta: meta(), rows: ROWS }, 5000);
        const text = formatCensusSummary(arm);
        expect(text).toContain("red entries 2/4, red rows 3/6");
        expect(text).toContain("rows over 5000ms: 3/6");
        expect(text).toContain(
            "green over 1, red under 1, green under 2, red over 2"
        );
        expect(text).toMatch(/lab proxy/);
    });

    it("recomputes the readings of merged slices from the joined rows", () => {
        const a = withCensusReadings(
            { meta: meta({ slices: ["1/2"] }), rows: ROWS.slice(0, 3) },
            5000
        );
        const b = withCensusReadings(
            { meta: meta({ slices: ["2/2"] }), rows: ROWS.slice(3) },
            5000
        );
        const merged = withCensusReadings(mergeCensusResults([a, b]), 5000);
        expect(merged.readings).toEqual(censusReadings(ROWS, 5000));
    });
});

describe("blade census — Line rows", () => {
    const decision = (
        step: number,
        followed: boolean,
        iterations: number,
        ms: number
    ): CensusLineDecision => ({
        step,
        followed,
        expected: null,
        chosen: null,
        mechanism: "mean-reward",
        candidates: 2,
        iterations,
        ms,
        rolloutProbes: 0,
    });
    const lineRow = (
        id: number,
        seed: number,
        failedAt: number | null,
        decisions: CensusLineDecision[]
    ): CensusRow =>
        row(id, "line: l", seed, failedAt === null, {
            line: { steps: 3, failedAt, decisions },
        });

    it("counts the seeds that play the first move and those that reach the end", () => {
        const rows = [
            lineRow(0, 1, null, [
                decision(0, true, 400, 100),
                decision(1, true, 400, 100),
                decision(2, true, 400, 100),
            ]),
            lineRow(1, 2, 1, [
                decision(0, true, 400, 100),
                decision(1, false, 400, 100),
            ]),
            lineRow(2, 3, 0, [decision(0, false, 400, 100)]),
            row(3, "scenario", 1, true),
        ];
        const [s] = lineCensusSummaries(rows);
        expect(lineCensusSummaries(rows)).toHaveLength(1);
        expect(s).toMatchObject({
            label: "line: l",
            seeds: 3,
            firstMove: 2,
            end: 1,
            stops: ["seed 1: end", "seed 2: decision 2", "seed 3: decision 1"],
        });
        // 2400 iterations over 600 ms of search loop.
        expect(s.iterationsPerSecond).toBe(4000);
        expect(
            formatCensusSummary(
                withCensusReadings({ meta: meta(), rows }, 5000)
            )
        ).toContain("line: l @400 — first 2/3, end 1/3, 4000 it/s");
    });

    it("reads a Line row's ms per iteration over every decision it ran", () => {
        const r = lineRow(0, 1, null, [
            decision(0, true, 400, 100),
            decision(1, true, 400, 100),
        ]);
        const readings = censusReadings([{ ...r, ms: 800 }], 5000);
        expect(readings.performance.msPerIteration.max).toBe(1);
    });
});
