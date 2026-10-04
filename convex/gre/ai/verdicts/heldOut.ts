// The held-out split — which Verdicts the Weight Fit may read (issue #3981,
// PRD #3980, ADR 0138).
//
// THE SPLIT. Every Verdict sits on one of two sides: the FIT side, which the
// Weight Fit reads, and the HELD-OUT side, which it never sees and on which
// agreement is measured. The side is a function of the Verdict's SCENARIO
// alone (`scenarioKeyOf`: spec, setup, seat, deck knowledge) — one bucket of
// `HELD_OUT_SPLIT_MODULUS` held out, by the scenario key's digest. So:
//
//   - DETERMINISTIC: the same Scenario Spec resolves to the same side on every
//     machine and every build — the digest is the identity primitive the
//     verdict id and the position key already use.
//   - STABLE: a Verdict's side reads nothing but its own scenario, never the
//     corpus around it, so adding a Verdict moves no other one's side.
//   - BY POSITION, NOT BY JUDGEMENT: two judgements of one board (a
//     contradiction, a reclassification) share a side, so the fit can never
//     learn one half of a disagreement the held-out side then grades it on.
//     The candidate keys are left out on purpose: they are the enumerator's
//     spelling on one build, and a rewording would reshuffle the split.
//
// THE OVERRIDE. A Test Position — a `must` or `stretch` blade registry entry
// — is fit-side by RULE, never by hash: the registry's own derived Verdicts
// (`source: "registry"`), and any store Verdict about the same scenario as a
// registry entry (a human admitted that position to the gate). The override is
// keyed on the registry's ENTRIES, not on the Verdicts they lower to, so an
// entry the lowering refuses (a `gap`) still claims its scenario.
//
// THE NARROWING. `fitInputPairs` is the one place a Weight Fit's input is
// assembled from a corpus: the held-out side's Eval Pairs are dropped BEFORE
// `fitWeights` is called, never ignored after it. Every caller that fits —
// `verdicts:promote`, `fit:weights`, the reproducibility guard — goes through
// it, so the committed weights are the fit of the fit side and nothing else.
// The rest of a report (rebuild errors, unsatisfied pairs, Minimal Pairs)
// still reads the whole corpus.
//
// Pure: no I/O, no engine import (the registry is a type here).

import type { BladeScenario } from "../blade/types";
import type { EvalPair } from "./evalPairs";
import { scenarioKeyOf, VERDICT_CANONICALISATION } from "./identity";
import type { Verdict } from "./types";

/** One Verdict in `HELD_OUT_SPLIT_MODULUS` is held out — 5, i.e. 20%. */
export const HELD_OUT_SPLIT_MODULUS = 5;

/** Which side of the split a Verdict sits on. */
export type VerdictSide = "fit" | "held-out";

/** How many hex digits of the digest pick the bucket: 32 bits, so the modulo
 *  bias at any small modulus is below one part in 10^8. */
const BUCKET_HEX_DIGITS = 8;

const KEY_PREFIX = `${VERDICT_CANONICALISATION}-`;

/** The bucket a scenario key falls in, `0 … modulus − 1`. Bucket 0 is the
 *  held-out one. Throws on a key that is not this canonicalisation's. */
export function heldOutBucketOf(
    scenarioKey: string,
    modulus: number = HELD_OUT_SPLIT_MODULUS
): number {
    if (!Number.isInteger(modulus) || modulus < 2) {
        throw new Error(
            `held-out modulus must be an integer >= 2, got ${modulus}`
        );
    }
    const digits = scenarioKey.startsWith(KEY_PREFIX)
        ? scenarioKey.slice(
              KEY_PREFIX.length,
              KEY_PREFIX.length + BUCKET_HEX_DIGITS
          )
        : "";
    if (!/^[0-9a-f]+$/.test(digits) || digits.length !== BUCKET_HEX_DIGITS) {
        throw new Error(
            `${JSON.stringify(scenarioKey)} is not a ${VERDICT_CANONICALISATION} scenario key`
        );
    }
    return parseInt(digits, 16) % modulus;
}

/** The scenario keys of every Test Position in the registry — `must` and
 *  `stretch` alike, whether or not the entry lowers to a Verdict. */
export function testPositionKeysOf(
    scenarios: readonly BladeScenario[]
): Set<string> {
    return new Set(
        scenarios.map((s) =>
            scenarioKeyOf({
                spec: s.spec,
                setup: s.setup,
                seat: s.bot,
                deckKnowledge: s.deckKnowledge,
            })
        )
    );
}

/** The side of the split `verdict` resolves to. `testPositions` is
 *  `testPositionKeysOf(<the registry>)`. */
export function verdictSideOf(
    verdict: Verdict,
    testPositions: ReadonlySet<string>,
    modulus: number = HELD_OUT_SPLIT_MODULUS
): VerdictSide {
    if (verdict.source === "registry") return "fit";
    const key = scenarioKeyOf(verdict);
    if (testPositions.has(key)) return "fit";
    return heldOutBucketOf(key, modulus) === 0 ? "held-out" : "fit";
}

/**
 * The Weight Fit's input: the Eval Pairs of `pairs` whose Verdict resolves
 * fit-side. Throws on a pair whose Verdict is not in `verdicts` — a pair of
 * unknown side is never let through to the fit.
 */
export function fitInputPairs(
    pairs: readonly EvalPair[],
    verdicts: readonly Verdict[],
    testPositions: ReadonlySet<string>,
    modulus: number = HELD_OUT_SPLIT_MODULUS
): EvalPair[] {
    const sideOf = new Map(
        verdicts.map((v) => [v.id, verdictSideOf(v, testPositions, modulus)])
    );
    return pairs.filter((pair) => {
        const side = sideOf.get(pair.verdictId);
        if (side === undefined) {
            throw new Error(
                `Eval Pair of ${pair.verdictId}: its Verdict is not in the corpus, so its side of the held-out split is unknown`
            );
        }
        return side === "fit";
    });
}
