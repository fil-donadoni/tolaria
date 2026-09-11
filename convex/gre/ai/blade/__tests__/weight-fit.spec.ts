// Issue #3401 — the Weight Fit over the blade registry's verdicts.
//
//  1. Always-on: the fit's report formatting on a synthetic, zero-cost pair.
//     (The fit itself is asserted on REAL registry positions by the bot
//     suite, `convex/gre/ai/__tests__/weightFit.bot.test.ts`, which is also
//     the reproducibility guard.)
//  2. The RUNNER (`bun run fit:weights`, gated by BLADE_FIT=1) — lowers the
//     registry to verdicts, builds every Eval Pair at the COMMITTED weights,
//     fits, and then RE-DERIVES the report at the fitted vector so the
//     after-state is the engine's own number and not the fit's first-order
//     prediction of it.
//
//       bun run fit:weights
//
//     Options: BLADE_FIT_TIER=must|stretch|all (default all),
//     BLADE_FIT_LAMBDA / BLADE_FIT_MARGIN / BLADE_FIT_TRUST / BLADE_FIT_STEPS
//     (sweeps — the committed defaults live in `verdicts/fit.ts`),
//     BLADE_FIT_OUT=<path>.json (write the vector, the movement and both
//     reports).
//
// It lives HERE, as a blade `*.spec.ts`, for the reason `verdict-report.spec.ts`
// gives: importing the blade module pulls `convex/game.ts` and with it
// `lib.dom`, which reds an unrelated script in the `scripts` project.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../registry";
import { DEFAULT_EVAL_WEIGHTS, FIT_BASE_EVAL_WEIGHTS } from "../../evalWeights";
import {
    FITTABLE_WEIGHT_KEYS,
    collectVerdictReport,
    fitWeights,
    formatFittedWeights,
    formatVerdictReport,
    formatWeightFitReport,
    verdictsFromRegistry,
    type EvalPair,
    type FittableWeightKey,
} from "../../verdicts";

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

// A sweep knob that is set but unreadable is a silent NaN in the vector, so
// anything that is not a finite number falls back to the committed default.
const num = (name: string): number | undefined => {
    const raw = ENV[name];
    if (raw === undefined || raw.trim() === "") return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new Error(`${name}="${raw}" is not a number`);
    }
    return value;
};

describe("weight fit report formatting (issue #3401)", () => {
    it("prints the headline counts, the movement and the pairs it bought", () => {
        const basis = {} as Record<FittableWeightKey, number>;
        for (const k of FITTABLE_WEIGHT_KEYS) basis[k] = 0;
        // One unit of `lifeWeight` and one of `permanentWeight`: the fit can
        // only reach the second, since life is the numeraire.
        basis.lifeWeight = 1;
        basis.permanentWeight = 1;
        const pair: EvalPair = {
            verdictId: "synthetic:one",
            kind: "right",
            rightIndex: 0,
            otherIndex: 1,
            right: { key: "a", description: "do the right thing" },
            other: { key: "b", description: "do the other thing" },
            terms: {
                life: 0,
                hand: 0,
                creatures: 0,
                permanents: 0,
                mana: 0,
                manaDevelopment: 0,
                flexibility: 0,
                library: 0,
                graveyard: 0,
                graveyardReach: 0,
            },
            basis,
            fittableDelta: 13,
            delta: 13,
        };
        const result = fitWeights([pair], FIT_BASE_EVAL_WEIGHTS);
        const text = formatWeightFitReport(result, 1);
        expect(text).toContain("1 pairs");
        expect(text).toContain("permanentWeight");
        // The numeraire is pinned even though the pair loads it.
        expect(
            result.movement.find((m) => m.key === "lifeWeight")!.relative
        ).toBe(0);
        expect(formatFittedWeights(result)).toContain("lifeWeight: 8,");
    });
});

const RUN = ENV.BLADE_FIT === "1";

describe.runIf(RUN)("weight fit (runner)", () => {
    it("fits the committed weights to the registry's verdicts", async () => {
        const tier = ENV.BLADE_FIT_TIER ?? "all";
        const scenarios = BLADE_SCENARIOS.filter(
            (s) => tier === "all" || s.tier === tier
        );
        const t0 = performance.now();
        const { verdicts, gaps } = verdictsFromRegistry(scenarios);
        // BOTH the pairs and the fit start from the hand-picked prior, never
        // from the committed vector: the basis is a derivative read at the
        // linearisation point, and `λ‖w − w0‖²` regularises toward `w0`. Refit
        // from the last answer and the weights ratchet away from anything a
        // human chose, one trust region per run (`evalWeights.ts`).
        const before = collectVerdictReport(verdicts, {
            gaps,
            weights: FIT_BASE_EVAL_WEIGHTS,
        });

        const result = fitWeights(before.pairs, FIT_BASE_EVAL_WEIGHTS, {
            margin: num("BLADE_FIT_MARGIN"),
            lambda: num("BLADE_FIT_LAMBDA"),
            steps: num("BLADE_FIT_STEPS"),
            trustRegion: num("BLADE_FIT_TRUST"),
        });

        // The honest after-state: the pairs are RE-DERIVED at the fitted
        // vector, so every nonlinearity the first-order `basis` cannot see
        // (the `latentBoardFor` ratio, a clamp a weight walked into) is
        // priced by the engine rather than predicted by the fit.
        const after = collectVerdictReport(verdicts, {
            gaps,
            weights: result.weights,
        });

        const text = [
            formatWeightFitReport(result, before.pairs.length),
            "",
            "== BEFORE (committed weights)",
            formatVerdictReport(before, 0),
            "",
            "== AFTER (fitted weights, re-derived through the engine)",
            formatVerdictReport(after, performance.now() - t0),
            "",
            "== the fitted vector, as the DEFAULT_EVAL_WEIGHTS literal",
            formatFittedWeights(result),
            "",
            JSON.stringify(result.weights) ===
            JSON.stringify(DEFAULT_EVAL_WEIGHTS)
                ? "== the committed DEFAULT_EVAL_WEIGHTS is up to date"
                : "== the committed DEFAULT_EVAL_WEIGHTS is STALE — paste the block above",
        ].join("\n");
        console.log(`\n${text}`);

        const outPath = ENV.BLADE_FIT_OUT;
        if (outPath) {
            const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as {
                writeFileSync: (p: string, d: string) => void;
            };
            fs.writeFileSync(
                outPath,
                JSON.stringify(
                    {
                        meta: {
                            tier,
                            entries: scenarios.length,
                            verdicts: verdicts.length,
                            pairs: before.pairs.length,
                            options: result.options,
                        },
                        weights: result.weights,
                        movement: result.movement,
                        summary: {
                            lossBefore: result.lossBefore,
                            lossAfter: result.lossAfter,
                            beforeSatisfied: before.satisfied.length,
                            afterSatisfied: after.satisfied.length,
                            beforeVerdictsOk: before.rows.filter((r) => r.ok)
                                .length,
                            afterVerdictsOk: after.rows.filter((r) => r.ok)
                                .length,
                            contradictions: result.contradictions.length,
                            blindBefore: before.blind.length,
                            blindAfter: after.blind.length,
                        },
                        stillViolated: result.violated.map((v) => ({
                            verdictId: v.pair.verdictId,
                            right: v.pair.right.description,
                            other: v.pair.other.description,
                            before: v.before,
                            predicted: v.predicted,
                        })),
                        text,
                    },
                    null,
                    2
                )
            );
            fs.writeFileSync(outPath.replace(/\.json$/, "") + ".txt", text);
        }
        expect(before.pairs.length).toBeGreaterThan(0);
    }, 3_600_000);
});
