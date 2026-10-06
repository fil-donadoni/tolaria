// Issue #4764 — every verdict of the committed corpus through the REAL search.
//
//  1. Always-on: the report's formatting on synthetic rows (zero cost).
//  2. The RUNNER (`bun run verdicts:search`, gated by BLADE_VERDICT_SEARCH=1)
//     — the registry, then the Verdict Lock (`committedVerdictCorpus`, the
//     corpus the Weight Fit guard reads), each verdict searched with a fixed
//     `iterations` budget on several seeds, and the agreement printed per
//     verdict, per class and for the timing class the fit no longer carries.
//     Report-only, never a gate.
//
//       bun run verdicts:search
//
//     A registry verdict is searched exactly as its blade entry is — the
//     entry's own budget and seeds. A locked verdict names no budget, so it
//     gets BLADE_VERDICT_SEARCH_ITERATIONS (default 400, the registry's most
//     common budget) on the blade's five seeds.
//     BLADE_VERDICT_SEARCH_SIDE=held-out restricts the run to the Verdicts the
//     Weight Fit never read and prints held-out pick agreement (issue #3982):
//     `bun run verdicts:pick-agreement`, the post-verdict health audit's step.
//     Options: BLADE_VERDICT_SEARCH_LABEL=<substring> (filter verdict ids),
//     BLADE_VERDICT_SEARCH_OUT=<path>.json (write rows + text).
//
// It lives HERE, as a blade `*.spec.ts`, for the reason `verdict-report.spec.ts`
// gives: the blade module drags `lib.dom` into any script that imports it.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../registry";
import { DEFAULT_BLADE_SEED } from "../runner";
import { committedVerdictCorpus } from "../../__tests__/committedVerdictCorpus.fixture";
import {
    burnedCountOf,
    formatHeldOutPickAgreement,
    formatVerdictSearchReport,
    searchHeldOutVerdicts,
    searchVerdict,
    testPositionKeysOf,
    type VerdictSearchBudget,
} from "../../verdicts";

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

const DEFAULT_SEEDS = [DEFAULT_BLADE_SEED, 1, 2, 3, 4];

describe("verdict search report formatting (issue #4764)", () => {
    it("prints the timing class beside the rest, and names a disagreement's picks", () => {
        const text = formatVerdictSearchReport(
            [
                {
                    verdictId: "registry:holds",
                    class: "pass",
                    timing: true,
                    agreed: 1,
                    seeds: 2,
                    picks: ["pass", "cast Impulse"],
                },
                {
                    verdictId: "registry:casts",
                    class: "cast",
                    timing: false,
                    agreed: 2,
                    seeds: 2,
                    picks: ["cast Bolt", "cast Bolt"],
                },
            ],
            "400 iterations"
        );
        expect(text).toContain("timing             : 1/2 (50.0%)");
        expect(text).toContain("everything else    : 2/2 (100.0%)");
        expect(text).toContain("  1/2 T registry:holds");
        expect(text).toContain("picks: pass | cast Impulse");
        expect(text).not.toContain("picks: cast Bolt");
    });
});

const RUN = ENV.BLADE_VERDICT_SEARCH === "1";

describe.runIf(RUN)("verdicts through the search (runner)", () => {
    it("searches every committed verdict and prints the agreement", async () => {
        const iterations = Number(ENV.BLADE_VERDICT_SEARCH_ITERATIONS ?? 400);
        const label = ENV.BLADE_VERDICT_SEARCH_LABEL;
        const byId = new Map<string, (typeof BLADE_SCENARIOS)[number]>(
            BLADE_SCENARIOS.map((s) => [`registry:${s.label}`, s])
        );
        const budgetOf = (id: string): VerdictSearchBudget => {
            const entry = byId.get(id);
            return entry
                ? {
                      iterations: entry.budget.iterations,
                      seeds: entry.seeds ?? [DEFAULT_BLADE_SEED],
                  }
                : { iterations, seeds: DEFAULT_SEEDS };
        };
        const { verdicts } = await committedVerdictCorpus(BLADE_SCENARIOS);
        const heldOut = ENV.BLADE_VERDICT_SEARCH_SIDE === "held-out";
        const selected = verdicts.filter((v) => !label || v.id.includes(label));
        const log = (row: ReturnType<typeof searchVerdict>) => {
            console.log(
                `${`${row.agreed}/${row.seeds}`.padStart(5)} ${row.timing ? "T" : " "} ${row.verdictId}`
            );
            return row;
        };
        // The split is read over the WHOLE corpus (a Minimal Pair's side is its
        // unit's); the label filter does not apply to a held-out run.
        const rows = heldOut
            ? searchHeldOutVerdicts(
                  verdicts,
                  testPositionKeysOf(BLADE_SCENARIOS),
                  (v) => budgetOf(v.id),
                  (v, budget) => log(searchVerdict(v, budget))
              )
            : selected.map((verdict) =>
                  log(searchVerdict(verdict, budgetOf(verdict.id)))
              );
        const budgetLine = `registry entries at their own budget and seeds, locked verdicts at ${iterations} iterations × ${DEFAULT_SEEDS.length} seeds`;
        const text = heldOut
            ? formatHeldOutPickAgreement(
                  rows,
                  budgetLine,
                  burnedCountOf(verdicts, testPositionKeysOf(BLADE_SCENARIOS))
              )
            : formatVerdictSearchReport(rows, budgetLine);
        console.log(`\n${text}`);
        const outPath = ENV.BLADE_VERDICT_SEARCH_OUT;
        if (outPath) {
            const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as {
                writeFileSync: (p: string, d: string) => void;
            };
            fs.writeFileSync(
                outPath,
                JSON.stringify({ text, rows }, null, 2) + "\n"
            );
        }
        if (!heldOut) expect(rows.length).toBe(selected.length);
    }, 3_600_000);
});
