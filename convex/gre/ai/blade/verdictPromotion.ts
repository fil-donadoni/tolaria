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
    formatTesterQuality,
    rewriteDefaultEvalWeights,
    serializeVerdictLock,
    testerQualityOf,
    validateStoreObjects,
    verdictsFromRegistry,
    weightValue,
    type StoreObject,
    type StoreValidation,
    type TesterFitReport,
    type Verdict,
    type VerdictAuthorAlias,
    type VerdictPromotionInput,
    type VerdictPromotionOutput,
} from "../verdicts";
import {
    decodeAliasObject,
    verdictIdOfObjectName,
} from "../../../verdictStore";
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
    if (input.mode === "testers") {
        return {
            mode: "testers",
            text: testersText(input, validation, scenarios),
        };
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

/**
 * The fit report over the committed lock: which locked verdicts have a pair
 * the committed weights leave unsatisfied. Re-derived with the guard's own
 * corpus (`lockedVerdictCorpus`) at the committed `DEFAULT_EVAL_WEIGHTS` —
 * the weights that guard proves ARE the fit over this lock — so the count is
 * never a tally kept beside the lock that could drift from it. The locked
 * payloads come from the snapshot's verdict objects and are re-hashed against
 * their ids by the lock reader. `null` when no lock is committed.
 */
function fitReportOverLock(
    input: VerdictPromotionInput,
    scenarios: readonly BladeScenario[]
): TesterFitReport | null {
    if (input.lock === null) return null;
    const lock = parseVerdictLock(input.lock);
    const locked = new Set(lock.verdictIds);
    const payloads = decodeObjects(input.verdictObjects).flatMap(
        ({ name, bytes }) => {
            const verdictId = verdictIdOfObjectName(name);
            if (verdictId === null || !locked.has(verdictId)) return [];
            try {
                return [
                    {
                        verdictId,
                        payload: JSON.parse(new TextDecoder().decode(bytes)),
                    },
                ];
            } catch (error) {
                throw new Error(
                    `${name}: the lock names it, but it is not JSON (${error instanceof Error ? error.message : String(error)})`
                );
            }
        }
    );
    const corpus = lockedVerdictCorpus(lock, payloads, scenarios);
    const report = collectVerdictReport(corpus.verdicts, {
        gaps: corpus.gaps,
        weights: DEFAULT_EVAL_WEIGHTS,
    });
    if (report.errors.length > 0) {
        throw new Error(
            `the locked corpus does not rebuild, so there is no fit report to read:\n${report.errors
                .map((e) => `  ${e.verdictId}: ${e.error}`)
                .join("\n")}`
        );
    }
    return {
        lock,
        unsatisfiedVerdictIds: [
            ...new Set(
                report.violated
                    .map((pair) => pair.verdictId)
                    // The blade registry's verdicts are code, attested by no one.
                    .filter((id) => locked.has(id))
            ),
        ],
    };
}

/** What `bun run verdicts:testers` prints (issue #3585). An alias that does
 *  not read joins nothing — two authors stay two people, the direction that
 *  never merges strangers — and is listed. */
function testersText(
    input: VerdictPromotionInput,
    validation: StoreValidation,
    scenarios: readonly BladeScenario[]
): string {
    const aliases: VerdictAuthorAlias[] = [];
    const problems: string[] = [];
    for (const { name, bytes } of decodeObjects(input.aliasObjects ?? [])) {
        try {
            aliases.push(decodeAliasObject(name, bytes));
        } catch (error) {
            problems.push(
                `  ${name}\n    ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
    // A store verdict the blade registry judges differently is held out of the
    // lock as `contested` while the store-only quarantine calls it promotable.
    const keyOf = new Map(
        validation.quarantine.promotable.map((v) => [
            v.verdictId,
            v.positionKey,
        ])
    );
    const registryContested = new Set(
        validation.rows
            .filter((r) => r.status === "contested" && r.verdictId !== null)
            .map((r) => keyOf.get(r.verdictId!))
            .filter((key): key is string => key !== undefined)
    );
    const report = testerQualityOf(
        validation.quarantine,
        aliases,
        fitReportOverLock(input, scenarios),
        registryContested
    );
    // An attestation or resolution that does not read changes who gave what,
    // so its count is printed beside the numbers it moved.
    const unread = [
        `attestation problems: ${validation.attestationProblems.length}`,
        `resolution problems: ${validation.resolutionProblems.length}`,
    ];
    return [
        formatTesterQuality(report),
        "",
        ...unread,
        ...(problems.length > 0
            ? ["", `alias problems: ${problems.length}`, ...problems]
            : []),
    ].join("\n");
}
