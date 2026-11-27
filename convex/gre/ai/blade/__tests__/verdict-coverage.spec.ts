// Issue #3588 — what the Verdict corpus COVERS, by decision class.
//
//  1. Always-on: the census's formatting on a synthetic, zero-cost corpus.
//     (The classifier itself is asserted by the bot suite,
//     `convex/gre/ai/__tests__/verdictCoverage.bot.test.ts`.)
//  2. Opt-in RUNNER (gated by BLADE_COVERAGE=1) — lowers the whole corpus,
//     builds every Eval Pair under the CURRENT weights, and prints the census
//     plus the collection targets. Never a gate: it measures the CORPUS, and
//     a corpus that is thin is a fact to act on, not a regression to red.
//
//       BLADE_COVERAGE=1 bunx vitest run --config vitest.blade.config.ts \
//         convex/gre/ai/blade/__tests__/verdict-coverage.spec.ts
//
//     Options: BLADE_COVERAGE_TIER=must|stretch|all (default all),
//     BLADE_COVERAGE_OUT=<path>.json (write the census rows).
//
//  3. Opt-in CENSUS GATE of the generated vector (ADR 0186; issue #10857,
//     gated by BLADE_COVERAGE_GENERATED=1) — the FIT side of the held-out
//     split only, the exam side dropped before a single position is rebuilt:
//     blind, contradictory and addressable pairs under the current vector and
//     under current + generated, the registered pass rule, and every pair
//     left blind. No fit.
//
//       BLADE_COVERAGE_GENERATED=1 bunx vitest run --config vitest.blade.config.ts \
//         --reporter=default convex/gre/ai/blade/__tests__/verdict-coverage.spec.ts
//
//     Option: BLADE_COVERAGE_OUT=<path>.txt (write the receipt).
//
// It lives HERE, as a blade `*.spec.ts`, for the reason `verdict-report.spec.ts`
// gives: importing the blade module pulls `convex/game.ts` and with it
// `lib.dom`, which reds an unrelated script in the `scripts` project.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../registry";
import { committedVerdictCorpus } from "../../__tests__/committedVerdictCorpus.fixture";
import { generatedPairReadings } from "../../generatedVector/pairReadings";
import {
    censusByClass,
    classesBelowFloor,
    collectVerdictReport,
    formatCensus,
    formatGeneratedCoverage,
    generatedCoverage,
    testPositionKeysOf,
    verdictSidesOf,
} from "../../verdicts";

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

describe("coverage census formatting (issue #3588)", () => {
    it("prints a row per class, the total, and the classes under the floor", () => {
        const census = censusByClass(
            {
                verdicts: 1,
                rows: [],
                pairs: [],
                satisfied: [],
                violated: [],
                contradictions: [],
                timing: [],
                contradictionsWithTiming: 0,
                blind: [],
                gaps: [],
                errors: [],
                incomplete: [],
            },
            [
                {
                    id: "authored:x",
                    spec: { cards: [] },
                    seat: "me",
                    candidates: [
                        { key: '{"kind":"play-land"}', description: "land" },
                        { key: '{"kind":"pass"}', description: "pass" },
                    ],
                    answer: { kind: "right", rightIndexes: [0] },
                    author: "tester",
                    createdAt: "2026-09-14T00:00:00.000Z",
                    source: "authored",
                },
            ]
        );
        const text = formatCensus(census);
        expect(text).toContain("land-drop");
        expect(text).toContain("TOTAL");
        expect(text).toContain("collection targets");
        // Blocking is absent from this corpus entirely, and an ABSENT class is
        // the one a census most easily forgets to mention.
        expect(classesBelowFloor(census).map((b) => b.class)).toContain(
            "declare-blockers"
        );
    });
});

const RUN = ENV.BLADE_COVERAGE === "1";

describe.runIf(RUN)("verdict coverage (runner)", () => {
    it("censuses the whole corpus by decision class", async () => {
        const tier = ENV.BLADE_COVERAGE_TIER ?? "all";
        const scenarios = BLADE_SCENARIOS.filter(
            (s) => tier === "all" || s.tier === tier
        );
        // The committed corpus (issue #3584): the registry, then the Verdict
        // Lock — the same reader the reproducibility guard fits over.
        const { verdicts, gaps } = await committedVerdictCorpus(scenarios);
        const report = collectVerdictReport(verdicts, {
            testPositions: new Set(),
            gaps,
        });
        const census = censusByClass(report, verdicts);
        console.log(`\n${formatCensus(census)}`);

        const outPath = ENV.BLADE_COVERAGE_OUT;
        if (outPath) {
            const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as {
                writeFileSync: (p: string, d: string) => void;
            };
            fs.writeFileSync(
                outPath,
                JSON.stringify(
                    {
                        rows: census.rows,
                        totals: census.totals,
                        belowFloor: classesBelowFloor(census),
                    },
                    null,
                    2
                )
            );
        }

        // The runner asserts only that it RAN over a corpus — the numbers are
        // the output, not the claim.
        expect(census.totals.verdicts).toBeGreaterThan(0);
    }, 600_000);
});

const RUN_GENERATED = ENV.BLADE_COVERAGE_GENERATED === "1";

describe.runIf(RUN_GENERATED)("generated vector census gate (runner)", () => {
    it("counts what the generated vector tells apart on the fit side, with no fit", async () => {
        const { verdicts, gaps } =
            await committedVerdictCorpus(BLADE_SCENARIOS);
        const testPositions = testPositionKeysOf(BLADE_SCENARIOS);
        // The exam side never reaches the rebuild: a Verdict of unknown side
        // (a half without its anchor) yields no pairs and is dropped too.
        const sides = verdictSidesOf(verdicts, testPositions);
        const fitSide = verdicts.filter((v) => sides.get(v.id) === "fit");
        const report = collectVerdictReport(fitSide, { testPositions, gaps });
        const readings = generatedPairReadings(fitSide, report.pairs);
        const coverage = generatedCoverage(report, (pair) => {
            const reading = readings.get(pair);
            if (!reading) throw new Error(`no reading for ${pair.verdictId}`);
            return reading;
        });
        const receipt = [
            `corpus: fit side only — ${fitSide.length} of ${verdicts.length} verdicts, ${report.pairs.length} pairs (exam side not read)`,
            formatGeneratedCoverage(coverage),
        ].join("\n");
        console.log(`\n${receipt}`);

        const outPath = ENV.BLADE_COVERAGE_OUT;
        if (outPath) {
            const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as {
                writeFileSync: (p: string, d: string) => void;
            };
            fs.writeFileSync(outPath, `${receipt}\n`);
        }

        // The numbers are the output; the runner asserts only that it read a
        // fit side, and that no exam Verdict reached the report.
        expect(fitSide.length).toBeGreaterThan(0);
        expect(
            report.pairs.every((p) => sides.get(p.verdictId) === "fit")
        ).toBe(true);
    }, 600_000);
});
