// The committed `DEFAULT_EVAL_WEIGHTS` literal, rewritten by a promotion
// (issue #3583, ADR 0128 §7).
//
// Widening the Verdict Lock and moving the committed weights are ONE change:
// the reproducibility guard (`weightFit.bot.test.ts`) re-fits the corpus the
// lock names and demands the literal, so a lock committed without its weights
// is red until they follow. `verdicts:promote` therefore writes both, and the
// literal it writes is `formatFittedWeights` — the same block
// `bun run fit:weights` prints — spliced over the body of the one declaration
// in the generated `fittedEvalWeights.ts` (issue #7653: a whole file, so the
// base writes it after each merge and a PR never carries it). Everything
// around the body (the header comment, the file) is left byte for byte.

import { formatFittedWeights, type WeightFitResult } from "./fit";
import { EVAL_WEIGHTS_PATH } from "./promotion";

const DECLARATION = "export const FITTED_EVAL_WEIGHTS = Object.freeze({\n";
const CLOSE = "\n});";

/** `source` (the contents of `EVAL_WEIGHTS_PATH`) with the fittable keys of
 *  `FITTED_EVAL_WEIGHTS` replaced by `result`'s fitted vector. Throws when the
 *  declaration is not there exactly once, rather than guessing where to write. */
export function rewriteDefaultEvalWeights(
    source: string,
    result: WeightFitResult
): string {
    const start = source.indexOf(DECLARATION);
    if (start < 0 || source.indexOf(DECLARATION, start + 1) >= 0) {
        throw new Error(
            `${EVAL_WEIGHTS_PATH}: expected exactly one FITTED_EVAL_WEIGHTS declaration`
        );
    }
    const body = start + DECLARATION.length;
    const end = source.indexOf(CLOSE, body);
    if (end < 0) {
        throw new Error(
            `${EVAL_WEIGHTS_PATH}: the FITTED_EVAL_WEIGHTS declaration never closes`
        );
    }
    return (
        source.slice(0, body) + formatFittedWeights(result) + source.slice(end)
    );
}
