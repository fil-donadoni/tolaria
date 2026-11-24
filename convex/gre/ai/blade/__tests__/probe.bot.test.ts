// `blade:probe`'s pure half and the rollout width counters (issue #10631):
// the legs and jobs a probe runs, how rows are read back into the admission
// verdict, and the width summary the census and the probe print.
import { describe, expect, it } from "vitest";
import {
    buildProbeJobs,
    formatProbeReport,
    planProbeLegs,
    probeAdmissionFloor,
    summarizeProbe,
    type ProbeEntry,
    type ProbeRow,
} from "../probe";
import { ROBUSTNESS_SEEDS } from "../robustnessClassify";
import {
    mergeRolloutWidth,
    newRolloutWidth,
    recordRolloutPly,
    summarizeRolloutWidth,
} from "../../rolloutWidth";
import { censusReadings, type CensusRow } from "../census";

const ENTRY: ProbeEntry = {
    label: "an entry",
    tier: "must",
    budget: { iterations: 400 },
    seeds: [0xb1ade, 1, 2],
};

/** Every job of the probe, answered `ok` unless `red` says otherwise. */
function answer(
    entry: ProbeEntry,
    seeds: number,
    red: (job: {
        variant: string | null;
        iterations: number;
        seed: number;
    }) => boolean = () => false,
    variant?: string
): ProbeRow[] {
    const jobs = buildProbeJobs(
        planProbeLegs(entry, { label: entry.label, seeds, variant })
    );
    return jobs.map((j) => ({
        ...j,
        ok: !red(j),
        move: red(j) ? "pass" : "attack",
        mechanism: red(j) ? "material-tiebreak" : "mean-reward",
        ms: 1,
    }));
}

describe("rollout width counters", () => {
    it("reads mean, nearest-rank p50 / p90 and the declaration share", () => {
        const w = newRolloutWidth();
        // 10 plies: widths 1..10, the last three declarations.
        for (let n = 1; n <= 10; n++) recordRolloutPly(w, n, n > 7);
        expect(summarizeRolloutWidth(w)).toEqual({
            plies: 10,
            mean: 5.5,
            p50: 5,
            p90: 9,
            declarationShare: 0.3,
        });
    });

    it("pools several searches, skipping the ones that recorded none", () => {
        const a = newRolloutWidth();
        const b = newRolloutWidth();
        recordRolloutPly(a, 2, false);
        recordRolloutPly(b, 2, true);
        recordRolloutPly(b, 8, false);
        const pooled = mergeRolloutWidth([a, undefined, b]);
        expect(pooled).toEqual({
            plies: 3,
            candidates: 12,
            declarationPlies: 1,
            hist: { "2": 2, "8": 1 },
        });
    });

    it("summarises an empty reading as zeros", () => {
        expect(summarizeRolloutWidth(newRolloutWidth())).toEqual({
            plies: 0,
            mean: 0,
            p50: 0,
            p90: 0,
            declarationShare: 0,
        });
    });
});

describe("blade probe legs and jobs", () => {
    it("runs half, declared and double budgets, the audit legs and the variant", () => {
        const legs = planProbeLegs(ENTRY, {
            label: ENTRY.label,
            seeds: 20,
            variant: "placebo",
        });
        expect(legs.map((l) => [l.key, l.iterations, l.seeds.length])).toEqual([
            ["own", 400, 3],
            ["half", 200, 20],
            ["declared", 400, 20],
            ["double", 800, 20],
            ["default", 400, ROBUSTNESS_SEEDS.length],
            ["jitter+", 400, ROBUSTNESS_SEEDS.length],
            ["jitter-", 400, ROBUSTNESS_SEEDS.length],
            ["variant", 400, 20],
        ]);
    });

    it("runs each (variant, budget, seed) cell once, costliest first, width on the declared base", () => {
        const jobs = buildProbeJobs(
            planProbeLegs(ENTRY, { label: ENTRY.label, seeds: 20 })
        );
        // ½×, 1×, 2× over 20 seeds + the two jitter legs over 10 + the own
        // seed 0xb1ade (1 and 2 are among the wide seeds; the audit default
        // leg is the declared one's first ten).
        expect(jobs).toHaveLength(60 + 20 + 1);
        const budgets = jobs.map((j) => j.iterations);
        expect(budgets).toEqual(budgets.slice().sort((a, b) => b - a));
        const measured = jobs.filter((j) => j.measureWidth);
        expect(measured).toHaveLength(21);
        expect(
            measured.every((j) => j.variant === null && j.iterations === 400)
        ).toBe(true);
    });

    it("refuses a non-positive seed count", () => {
        expect(() =>
            planProbeLegs(ENTRY, { label: ENTRY.label, seeds: 0 })
        ).toThrow(/--seeds/);
    });
});

describe("blade probe verdict", () => {
    it("admits a ROBUST entry that passes at least 19 of 20 at its budget", () => {
        const rows = answer(
            ENTRY,
            20,
            (j) => j.variant === null && j.iterations === 200 && j.seed === 7
        );
        const report = summarizeProbe(
            ENTRY,
            { label: ENTRY.label, seeds: 20 },
            rows
        );
        expect(report.robustness).toBe("robust");
        expect(report.admitted).toBe(true);
        expect(report.legs.find((l) => l.leg.key === "half")!.passed).toBe(19);
    });

    it("refuses a NOISE-PINNED entry: a jittered vector fails one seed", () => {
        const rows = answer(
            ENTRY,
            20,
            (j) => j.variant === "robustness:jitter+" && j.seed === 3
        );
        const report = summarizeProbe(
            ENTRY,
            { label: ENTRY.label, seeds: 20 },
            rows
        );
        expect(report.robustness).toBe("noise-pinned");
        expect(report.admitted).toBe(false);
        expect(formatProbeReport(report)).toContain(
            "✗ audit jitter+ seed 3: pass [material-tiebreak]"
        );
    });

    it("refuses a ROBUST entry under the 19/20 bar at its budget", () => {
        // Seeds 10 and 11 fail at 1×: outside the audit's 0..9, so the
        // audit reads ROBUST while the wide count is 18/20.
        const rows = answer(
            ENTRY,
            20,
            (j) =>
                j.variant === null &&
                j.iterations === 400 &&
                (j.seed === 10 || j.seed === 11)
        );
        const report = summarizeProbe(
            ENTRY,
            { label: ENTRY.label, seeds: 20 },
            rows
        );
        expect(report.robustness).toBe("robust");
        expect(report.admitted).toBe(false);
    });

    it("reads a discriminating pair as base N/N, variant 0/N", () => {
        const rows = answer(
            ENTRY,
            20,
            (j) => j.variant === "placebo",
            "placebo"
        );
        const report = summarizeProbe(
            ENTRY,
            { label: ENTRY.label, seeds: 20, variant: "placebo" },
            rows
        );
        const pass = (k: string) =>
            report.legs.find((l) => l.leg.key === k)!.passed;
        expect([pass("declared"), pass("variant")]).toEqual([20, 0]);
        expect(report.admitted).toBe(true);
    });

    it("throws on a cell no row answers instead of reading it as a pass", () => {
        const rows = answer(ENTRY, 20).filter(
            (r) => !(r.iterations === 800 && r.seed === 5)
        );
        expect(() =>
            summarizeProbe(ENTRY, { label: ENTRY.label, seeds: 20 }, rows)
        ).toThrow(/no row for base 2× seed 5/);
    });

    it("scales the admission floor with --seeds", () => {
        expect(probeAdmissionFloor(20)).toBe(19);
        expect(probeAdmissionFloor(40)).toBe(38);
        expect(probeAdmissionFloor(10)).toBe(10);
    });
});

describe("census width reading", () => {
    const row = (label: string, widths: number[]): CensusRow => {
        const width = newRolloutWidth();
        for (const n of widths) recordRolloutPly(width, n, false);
        return {
            id: 0,
            label,
            seed: 0,
            iterations: 400,
            ok: true,
            move: "",
            reason: "",
            mechanism: null,
            ms: 1,
            width,
        };
    };

    it("pools every row and reads each entry's mean over entries", () => {
        const r = censusReadings(
            [row("a", [2, 2]), row("a", [4]), row("b", [10])],
            1000
        );
        expect(r.width!.pooled.plies).toBe(4);
        expect(r.width!.pooled.mean).toBe(4.5);
        // a: 8/3, b: 10.
        expect(r.width!.perEntryMean.max).toBe(10);
        expect(r.width!.perEntryMean.mean).toBeCloseTo((8 / 3 + 10) / 2);
    });

    it("carries no width reading when no row measured one", () => {
        const bare: CensusRow = { ...row("a", []), width: undefined };
        expect(censusReadings([bare], 1000).width).toBeUndefined();
    });
});
