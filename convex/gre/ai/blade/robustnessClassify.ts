/**
 * The registry-free half of the blade robustness audit (issue #4875): the
 * wide seed list and the classification of one entry's legs. Its own module
 * (issue #10631) so `scripts/blade-probe.ts` can classify the rows its
 * workers wrote without importing the runner, which drags the registry and
 * `lib.dom` into the `scripts` project. `./robustness` re-exports all of it.
 */

/** The wide seed list every entry is re-run over. Fixed forever — changing it
 *  re-rolls the whole audit and invalidates the baseline. */
export const ROBUSTNESS_SEEDS: readonly number[] = Array.from(
    { length: 10 },
    (_, i) => i
);

/** One vector's leg of an entry: how many of the wide seeds pass, and which
 *  root mechanism decided each run. */
export type RobustnessLeg = {
    vector: string;
    seeds: number;
    passed: number;
    /** `RootDecisionMechanism` → runs it settled. `material-tiebreak` on a
     *  failing entry is the usual noise signature (a near-tie). */
    mechanisms: Record<string, number>;
    /** The failing seeds with the move chosen, for the report line. */
    failures: { seed: number; move: string }[];
};

export type RobustnessVerdict = "robust" | "noise-pinned" | "wrong";

/** `robust` — every run passes; `noise-pinned` — the entry's own seeds pass,
 *  some other run fails; `wrong` — the entry's own seeds fail. */
export function classifyRobustness(
    own: { seeds: number; passed: number },
    legs: readonly { seeds: number; passed: number }[]
): RobustnessVerdict {
    if (own.passed < own.seeds) return "wrong";
    return legs.every((leg) => leg.passed === leg.seeds)
        ? "robust"
        : "noise-pinned";
}
