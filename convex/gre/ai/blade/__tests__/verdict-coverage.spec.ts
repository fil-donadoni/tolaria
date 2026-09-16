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
// It lives HERE, as a blade `*.spec.ts`, for the reason `verdict-report.spec.ts`
// gives: importing the blade module pulls `convex/game.ts` and with it
// `lib.dom`, which reds an unrelated script in the `scripts` project.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../registry";
import { committedVerdictCorpus } from "../../__tests__/committedVerdictCorpus";
import {
    censusByClass,
    classesBelowFloor,
    collectVerdictReport,
    formatCensus,
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
                blind: [],
                gaps: [],
                errors: [],
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
        const report = collectVerdictReport(verdicts, { gaps });
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
