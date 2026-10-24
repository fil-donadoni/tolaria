// The steps of `bun run bot:refit` (issue #6690, ADR 0158 §3).
//
// A Bot change that moves the committed weights or the search's figures reds
// pins in sequence — the reproducibility guard, the search-cost counters, the
// evaluation-value pins — each needing its own fix-forward. This is the one
// step that regenerates them together, and the one check that says which lags.
//
//   bun run bot:refit            re-fit the weights, then re-record every pin
//   bun run bot:refit --check    read-only: the same pins, asserting
//
// Pure: the plan is data, `scripts/bot-refit.ts` runs it.

/** The derived-figure pins a weight refit or a search change moves. Each is a
 *  bot-node test that asserts a recorded figure; recording is
 *  `RECORD_BOT_PINS=1` (fixtures written by the test) or vitest `-u` (the
 *  census's snapshot file). */
export const BOT_PIN_TESTS = [
    "convex/gre/__tests__/searchCost.bot.test.ts",
    "convex/gre/__tests__/searchForcedPass.bot.test.ts",
    "convex/gre/__tests__/searchLeafScore.bot.test.ts",
    "convex/gre/__tests__/evaluateManaCensus.bot.test.ts",
] as const;

/** The Weight Fit's reproducibility guard (ADR 0124 §3): byte-exact, never
 *  re-recorded by hand — `bot:refit` writes the literal it demands. */
export const WEIGHT_FIT_TEST = "convex/gre/ai/__tests__/weightFit.bot.test.ts";
export const WEIGHT_FIT_FILTER = "reproduces DEFAULT_EVAL_WEIGHTS";

export type RefitStep = {
    id: string;
    /** argv, never a shell string. */
    argv: readonly string[];
    env: Readonly<Record<string, string>>;
    /** What a non-zero exit of this step means, for the report. */
    onFail: string;
};

const VITEST_BOT = ["bunx", "vitest", "run", "--project", "bot-node"] as const;

/** Re-fit `DEFAULT_EVAL_WEIGHTS` over the registry + the Verdict Lock and
 *  write the literal. */
export const FIT_WRITE_STEP: RefitStep = {
    id: "weights",
    argv: [
        "bunx",
        "vitest",
        "run",
        "--config",
        "vitest.blade.config.ts",
        "convex/gre/ai/blade/__tests__/weight-fit.spec.ts",
    ],
    env: { BLADE_FIT: "1", BLADE_FIT_WRITE: "1" },
    onFail: "the fit did not run — evalWeights.ts is untouched",
};

/** Re-record every pin, in a process that starts AFTER the weights are on
 *  disk (a module graph is read once). */
export const RECORD_PINS_STEP: RefitStep = {
    id: "pins",
    // `-u` takes an optional value: before the paths it swallows the first one.
    argv: [...VITEST_BOT, ...BOT_PIN_TESTS, "-u"],
    env: { RECORD_BOT_PINS: "1" },
    onFail: "a pin test failed while recording — a fixture may be half-written",
};

/** The weights guard, then every pin, asserting. */
export const VERIFY_STEPS: readonly RefitStep[] = [
    {
        id: "weights-guard",
        argv: [...VITEST_BOT, WEIGHT_FIT_TEST, "-t", WEIGHT_FIT_FILTER],
        env: {},
        onFail: "DEFAULT_EVAL_WEIGHTS is not the fit of the committed verdicts",
    },
    {
        id: "pins-guard",
        argv: [...VITEST_BOT, ...BOT_PIN_TESTS],
        env: {},
        onFail: "a pin lags the weights or the search",
    },
];

/** The steps `bot:refit` runs for `args`: `--check` verifies only. */
export function refitPlan(args: readonly string[]): readonly RefitStep[] {
    const unknown = args.filter((a) => a !== "--check");
    if (unknown.length > 0) {
        throw new Error(`bot:refit: unknown argument ${unknown.join(" ")}`);
    }
    return args.includes("--check")
        ? VERIFY_STEPS
        : [FIT_WRITE_STEP, RECORD_PINS_STEP, ...VERIFY_STEPS];
}
