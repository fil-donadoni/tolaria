import { describe, expect, it } from "vitest";
import {
    DEFAULT_CENSUS_SEED,
    buildCensusJobs,
    censusVerdicts,
    diffCensus,
    mergeCensusResults,
    parseSlice,
    selectCensusEntries,
    sliceCensusJobs,
    type CensusEntry,
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
