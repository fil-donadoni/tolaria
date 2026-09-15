// The engine half of `bun run verdicts:validate` and `bun run verdicts:promote`
// (issue #3583, PRD #3574, ADR 0128 §7).
//
// WHY IT IS NOT IN THE SCRIPT. Rebuilding a verdict's position and fitting the
// weights both reach the blade builder, and through it `convex/game.ts` and
// `lib.dom` — which a `scripts/` entry cannot import without reddening the
// scripts type-check. So the script does the store I/O and the writes, and
// hands a snapshot to this step through the blade vitest config
// (`__tests__/verdict-promotion.spec.ts`): the shape `bun run fit:weights`
// already has.
//
// WHAT A PROMOTION COMPUTES IS WHAT THE GUARD COMPUTES. The corpus is the
// blade registry's verdicts followed by the lock's (`lockedVerdictCorpus`),
// the pairs are built at `FIT_BASE_EVAL_WEIGHTS`, and the fit starts there —
// the exact pipeline `weightFit.bot.test.ts` re-runs. The weights this writes
// are therefore the weights that guard demands of the lock it writes, and a
// lock committed without them is red.

import { DEFAULT_EVAL_WEIGHTS, FIT_BASE_EVAL_WEIGHTS } from "../evalWeights";
import {
    FITTABLE_WEIGHT_KEYS,
    collectVerdictReport,
    evalPairsOf,
    fitWeights,
    formatPromotionReport,
    formatStoreValidation,
    formatVerdictQuarantine,
    lockedVerdictCorpus,
    parseVerdictLock,
    planPromotion,
    rewriteDefaultEvalWeights,
    serializeVerdictLock,
    validateStoreObjects,
    verdictsFromRegistry,
    weightValue,
    type StoreObject,
    type Verdict,
    type VerdictPromotionInput,
    type VerdictPromotionOutput,
} from "../verdicts";
import { BLADE_SCENARIOS } from "./registry";
import type { BladeScenario } from "./types";

const decodeObjects = (
    objects: VerdictPromotionInput["verdictObjects"]
): StoreObject[] =>
    objects.map(({ name, base64 }) => ({
        name,
        bytes: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
    }));

/** A verdict's position rebuilds and still offers its judged candidates —
 *  asked of the Eval Pair bridge itself, so "rebuilds" means "yields pairs". */
const rebuildCheck = (verdict: Verdict): string | null =>
    evalPairsOf(verdict, FIT_BASE_EVAL_WEIGHTS).error ?? null;

/**
 * Classify a store snapshot; for a promotion, also plan the lock, fit the
 * corpus it names and render the report and the rewritten weights.
 *
 * Throws when the promoted corpus does not rebuild in full — the guard would
 * refuse that lock, so no command may produce one.
 */
export function runVerdictPromotionStep(
    input: VerdictPromotionInput,
    scenarios: readonly BladeScenario[] = BLADE_SCENARIOS
): VerdictPromotionOutput {
    const validation = validateStoreObjects(
        decodeObjects(input.verdictObjects),
        decodeObjects(input.attestationObjects),
        rebuildCheck,
        verdictsFromRegistry(scenarios).verdicts,
        // An admin's resolutions (issue #3582): a resolved position enters the
        // lock through its accepted verdict and no other.
        decodeObjects(input.resolutionObjects ?? [])
    );
    const validationText = formatStoreValidation(validation);
    if (input.mode === "validate") {
        return { mode: "validate", text: validationText };
    }

    const current = input.lock === null ? null : parseVerdictLock(input.lock);
    const plan = planPromotion(current, validation);
    if (plan.noop) {
        return {
            mode: "promote",
            noop: true,
            text: [
                validationText,
                "",
                `nothing to promote — the lock already names every promotable verdict (${plan.lock.verdictIds.length}) under pack ${plan.lock.packHash}; nothing rewritten`,
            ].join("\n"),
        };
    }

    const corpus = lockedVerdictCorpus(plan.lock, plan.entries, scenarios);
    const before = collectVerdictReport(corpus.verdicts, {
        gaps: corpus.gaps,
        weights: FIT_BASE_EVAL_WEIGHTS,
    });
    if (before.errors.length > 0) {
        throw new Error(
            `the promoted corpus does not rebuild, so no lock over it could pass the guard:\n${before.errors
                .map((e) => `  ${e.verdictId}: ${e.error}`)
                .join("\n")}`
        );
    }
    const result = fitWeights(before.pairs, FIT_BASE_EVAL_WEIGHTS);
    // The report's pairs are RE-DERIVED at the fitted vector, as
    // `bun run fit:weights` does: the fit's own `predicted` is first-order.
    const after = collectVerdictReport(corpus.verdicts, {
        gaps: corpus.gaps,
        weights: result.weights,
    });
    const added = new Set(plan.added);

    const text = [
        validationText,
        "",
        formatVerdictQuarantine(validation.quarantine),
        "",
        formatPromotionReport({
            plan,
            lockedBefore: current?.verdictIds.length ?? 0,
            newPairs: after.pairs.filter((p) => added.has(p.verdictId)),
            unsatisfied: after.violated,
            movement: FITTABLE_WEIGHT_KEYS.map((key) => ({
                key,
                committed: weightValue(DEFAULT_EVAL_WEIGHTS, key),
                fitted: weightValue(result.weights, key),
            })),
        }),
    ].join("\n");

    return {
        mode: "promote",
        noop: false,
        text,
        lock: plan.lock,
        lockText: serializeVerdictLock(plan.lock),
        evalWeightsSource: rewriteDefaultEvalWeights(
            input.evalWeightsSource,
            result
        ),
    };
}
