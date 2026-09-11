// Issue #3400 — the Eval Pair report over the blade registry's verdicts.
//
//  1. Always-on: the report's formatting on a synthetic, zero-cost corpus.
//     (The bridge itself is asserted on real positions by the bot suite,
//     `convex/gre/ai/__tests__/verdicts.bot.test.ts`.)
//  2. Opt-in RUNNER (gated by BLADE_VERDICTS=1) — lowers the whole registry
//     to verdicts, builds every Eval Pair under the CURRENT weights and
//     prints the violation / contradiction report. Never a gate: this is the
//     BEFORE-STATE the Weight Fit has to beat, not a claim about the Bot.
//
//       BLADE_VERDICTS=1 bunx vitest run --config vitest.blade.config.ts \
//         convex/gre/ai/blade/__tests__/verdict-report.spec.ts
//
//     Options: BLADE_VERDICTS_TIER=must|stretch|all (default all),
//     BLADE_VERDICTS_LABEL=<substring> (filter entries),
//     BLADE_VERDICTS_OUT=<path>.json (write rows + pairs + text).
//
// It lives HERE, as a blade `*.spec.ts`, and not under `scripts/`: importing
// the blade module pulls `convex/game.ts` (through `setup.ts`'s engine-real
// steps) and with it `_generated/api` → `@auth/core` → preact → `lib.dom`,
// which changes how the scripts project types `Response` and reds an
// unrelated script (`telemetry-serve.ts`). Same reason `greedyReport.ts`
// lives next to the runner.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../registry";
import {
    collectVerdictReport,
    formatVerdictReport,
    formatVerdictRow,
    verdictCorpus,
    VERDICT_DIR,
} from "../../verdicts";

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

describe("verdict report formatting (issue #3400)", () => {
    it("prints the headline counts, the violated pairs and the gaps", () => {
        const report = collectVerdictReport([], {
            gaps: [
                {
                    label: "some predicate entry",
                    tier: "stretch",
                    reason: "predicate",
                    detail: "the move leaves the trick up",
                },
            ],
        });
        const text = formatVerdictReport(report, 1_000);
        expect(text).toContain("0 verdicts, 0 pairs");
        expect(text).toContain("sources that yielded NO verdict (1)");
        expect(text).toContain("some predicate entry");
        expect(
            formatVerdictRow({
                verdictId: "registry:x",
                kind: "right",
                candidates: 3,
                pairs: 2,
                violated: 1,
                ok: false,
            })
        ).toContain("1/2 pairs");
    });
});

const RUN = ENV.BLADE_VERDICTS === "1";

describe.runIf(RUN)("verdict report (runner)", () => {
    it("lowers the registry to verdicts and reports every Eval Pair", async () => {
        const tier = ENV.BLADE_VERDICTS_TIER ?? "all";
        const label = ENV.BLADE_VERDICTS_LABEL;
        const scenarios = BLADE_SCENARIOS.filter(
            (s) =>
                (tier === "all" || s.tier === tier) &&
                (!label || s.label.includes(label))
        );
        const t0 = performance.now();
        // THE WHOLE CORPUS, not just the registry (issue #3402). The runner
        // reads `data/verdicts/**` itself because this module is pure by
        // design — it takes file CONTENTS, never a path — so the filesystem
        // belongs to whoever has one. Same dynamic-import trick the
        // `BLADE_VERDICTS_OUT` write below uses, for the same reason: this
        // project is not node-typed.
        const fsIn = (await import(/* @vite-ignore */ "node" + ":fs")) as {
            existsSync: (p: string) => boolean;
            readdirSync: (p: string) => string[];
            readFileSync: (p: string, enc: string) => string;
        };
        const files = fsIn.existsSync(VERDICT_DIR)
            ? fsIn
                  .readdirSync(VERDICT_DIR)
                  .filter((name) => name.endsWith(".json"))
                  .sort()
                  .map((name) => ({
                      path: `${VERDICT_DIR}/${name}`,
                      contents: fsIn.readFileSync(
                          `${VERDICT_DIR}/${name}`,
                          "utf8"
                      ),
                  }))
            : [];
        const { verdicts, gaps } = verdictCorpus(files, scenarios);
        const report = collectVerdictReport(verdicts, {
            gaps,
            onRow: (row) => console.log(formatVerdictRow(row)),
        });
        const text = formatVerdictReport(report, performance.now() - t0);
        console.log(`\n${text}`);
        const outPath = ENV.BLADE_VERDICTS_OUT;
        if (outPath) {
            // Same dynamic-import trick as `greedy-report.spec.ts`: this
            // project is not node-typed, and vitest's reporter does not
            // reliably surface large console output.
            const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as {
                writeFileSync: (p: string, d: string) => void;
            };
            fs.writeFileSync(
                outPath,
                JSON.stringify(
                    {
                        meta: {
                            tier,
                            label: label ?? null,
                            entries: scenarios.length,
                            files: files.length,
                            verdicts: verdicts.length,
                        },
                        text,
                        rows: report.rows,
                        gaps: report.gaps,
                        errors: report.errors,
                        violated: report.violated.map((p) => ({
                            verdictId: p.verdictId,
                            kind: p.kind,
                            right: p.right.description,
                            other: p.other.description,
                            delta: p.delta,
                            fittableDelta: p.fittableDelta,
                            terms: p.terms,
                            basis: p.basis,
                        })),
                    },
                    null,
                    2
                )
            );
            fs.writeFileSync(outPath.replace(/\.json$/, "") + ".txt", text);
        }
        expect(report.rows.length).toBeGreaterThan(0);
    }, 3_600_000);
});
