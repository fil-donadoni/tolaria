// What `check:weight-noise` runs and how it moves the weights.
//
// A refit moves the fitted weights on the base, after the merge, and a Bot test
// that pins float noise (an exact assertion on a sum or a difference) reds there.
// Moving each weight by its last digit changes no decision but moves the noise, so
// a red under the nudge means the test pins the noise or a weight's exact value.
//
// Pure: `scripts/check-weight-noise.ts` runs it, `vitest.weight-noise.config.ts`
// applies the nudge. Leaf, like `./bot-refit`.

import { BOT_PIN_TESTS, WEIGHT_FIT_TEST } from "./bot-refit";

export const FITTED_WEIGHTS_MODULE =
    /\/convex\/gre\/ai\/fittedEvalWeights\.ts$/;

const FITTED_WEIGHT_LITERAL = /: (-?\d+\.\d{6}),/g;
const LAST_DIGIT = 1e-6;

/** The weights module's source with every fitted literal moved one last digit,
 *  alternating down and up. One nudge is one vitest run, which keeps the guard in
 *  the lane's tier; noise that happens to cancel under it escapes. A source with
 *  no literal throws: a nudge that moved nothing would prove nothing. */
export function nudgeWeightsSource(source: string): string {
    let index = 0;
    const nudged = source.replace(
        FITTED_WEIGHT_LITERAL,
        (_, literal: string) => {
            const up = index++ % 2 === 1;
            const moved = Number(literal) + (up ? LAST_DIGIT : -LAST_DIGIT);
            return `: ${moved.toFixed(6)},`;
        }
    );
    if (index === 0)
        throw new Error(
            "weight-noise: no fitted literal to nudge in the weights module"
        );
    return nudged;
}

/** Spawns a worker and compares it with the in-process run: the plugin's nudge
 *  does not reach the child, so the two sides differ by the nudge itself. */
const WORKER_BOUNDARY_TEST =
    "scripts/__tests__/ladder-worker-boundary.bot.test.ts";

/** The files a nudge reds for a reason other than noise: the pins `bot:refit`
 *  re-records follow the weights by design. */
const EXEMPT: ReadonlySet<string> = new Set([
    ...BOT_PIN_TESTS,
    WEIGHT_FIT_TEST,
    WORKER_BOUNDARY_TEST,
]);

/** The diff's paths the guard runs: `bot-node` test files, and those only. */
export function noiseCheckedFiles(changed: readonly string[]): string[] {
    return changed.filter(
        (path) => path.endsWith(".bot.test.ts") && !EXEMPT.has(path)
    );
}

/** The run under the nudge. A changed `.bot.test.ts` can belong to another project
 *  (a `bot-dom` file, the ladder), and vitest exits 1 when none of the files match:
 *  that is nothing to check, not a noise pin. */
export function weightNoiseVitestArgs(files: readonly string[]): string[] {
    return [
        "vitest",
        "run",
        "--config",
        "vitest.weight-noise.config.ts",
        "--project",
        "bot-node",
        "--passWithNoTests",
        ...files,
    ];
}
