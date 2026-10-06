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
//   - STABLE: a Verdict's side reads nothing but its own scenario (and, for a
//     Minimal Pair half, its anchor's — below), never the corpus around it,
//     so adding a Verdict moves no other one's side.
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
// A MINIMAL PAIR IS ONE UNIT (ADR 0148, GLOSSARY.md § Held-out Agreement):
// either half alone is half an argument — a "wrong now" fitted without its
// right-hand half teaches "never", the half alone "always" — so the two halves
// always fall on the same side. The unit takes its ANCHOR's scenario bucket,
// and is fit-side if ANY member is a Test Position. That one lookup is the
// only thing `verdictSidesOf` reads beyond a Verdict itself, and it reads the
// unit, never the rest of the corpus: a half's side moves only when its own
// anchor arrives, and a half without its anchor yields no Eval Pairs at all
// (`report.ts`, `incomplete`) — its side stays UNKNOWN, so a pair of it would
// be refused rather than fitted.
//
// THE NARROWING. `fitInputPairs` is the one place a Weight Fit's input is
// assembled from a corpus: the held-out side's Eval Pairs are dropped BEFORE
// `fitWeights` is called, never ignored after it. Every caller that fits —
// `verdicts:promote`, `fit:weights`, the reproducibility guard — goes through
// it, so the committed weights are the fit of the fit side and nothing else.
// The rest of a report (rebuild errors, unsatisfied pairs, Minimal Pairs)
// still reads the whole corpus.
//
// THE PASTE DECISION reads the same narrowing: `sideReportOf` restricts a
// whole-corpus report to one side, and `fit:weights` scores the fitted and the
// incumbent vectors on the FIT side only (issue #5070) — a vector is never
// chosen by the Verdicts the split holds out. The held-out side is scored
// beside it, for information.
//
// Pure: no I/O, no engine import (the registry is a type here).

import type { BladeScenario } from "../blade/types";
import type { EvalPair } from "./evalPairs";
import {
    scenarioKeyOf,
    verdictIdOf,
    VERDICT_CANONICALISATION,
} from "./identity";
import type { VerdictJudgement } from "./identity";
import type { VerdictReport } from "./report";
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

function isTestPosition(
    verdict: Verdict,
    testPositions: ReadonlySet<string>
): boolean {
    return (
        verdict.source === "registry" ||
        testPositions.has(scenarioKeyOf(verdict))
    );
}

/** The side of the split `verdict` resolves to ON ITS OWN — exact for every
 *  Verdict outside a Minimal Pair; a pair member's side is its unit's
 *  (`verdictSidesOf`). `testPositions` is `testPositionKeysOf(<the
 *  registry>)`. */
export function verdictSideOf(
    verdict: Verdict,
    testPositions: ReadonlySet<string>,
    modulus: number = HELD_OUT_SPLIT_MODULUS
): VerdictSide {
    if (isTestPosition(verdict, testPositions)) return "fit";
    return heldOutBucketOf(scenarioKeyOf(verdict), modulus) === 0
        ? "held-out"
        : "fit";
}

/**
 * The side of every Verdict in `verdicts`, by `verdict.id`, with each Minimal
 * Pair resolved as one unit (header). A right-hand half whose anchor is not in
 * `verdicts` has NO entry: its side is unknown, and it yields no pairs.
 */
export function verdictSidesOf(
    verdicts: readonly Verdict[],
    testPositions: ReadonlySet<string>,
    modulus: number = HELD_OUT_SPLIT_MODULUS
): Map<string, VerdictSide> {
    // A half names its anchor by verdict id (`pairOf.anchorId`), which for a
    // registry anchor is not its `verdict.id` (`registry:<label>`).
    const byHash = new Map(verdicts.map((v) => [verdictIdOf(v), v]));
    const halvesOf = new Map<Verdict, Verdict[]>();
    for (const v of verdicts) {
        const anchor = v.pairOf && byHash.get(v.pairOf.anchorId);
        if (anchor) halvesOf.set(anchor, [...(halvesOf.get(anchor) ?? []), v]);
    }
    const unitSide = (anchor: Verdict): VerdictSide =>
        (halvesOf.get(anchor) ?? []).some((h) =>
            isTestPosition(h, testPositions)
        )
            ? "fit"
            : verdictSideOf(anchor, testPositions, modulus);
    const sides = new Map<string, VerdictSide>();
    for (const v of verdicts) {
        if (v.pairOf === undefined) {
            sides.set(v.id, unitSide(v));
            continue;
        }
        const anchor = byHash.get(v.pairOf.anchorId);
        if (anchor) sides.set(v.id, unitSide(anchor));
    }
    return sides;
}

/**
 * The BURNED Verdicts: store Verdicts whose unit hashes into the held-out
 * bucket but which the Test Position override makes fit-side — held-out
 * positions a human admitted to the registry anyway (issue #3983, PRD #3980).
 * Each is a position the held-out side can no longer grade.
 *
 * DERIVED, never stored: Admission is a hand edit of the registry, so there is
 * no event to count — the corpus and the registry say it all. A Minimal Pair
 * half is judged by its ANCHOR's bucket (the unit's, `verdictSidesOf`).
 *
 * The choice the issue leaves open: a registry entry with no store Verdict
 * about its scenario is NOT burned. It was never a judgement on the held-out
 * side, so `source: "registry"` Verdicts are excluded — only a store Verdict
 * the override moved counts. A pair half whose anchor is absent has no known
 * unit, hence no bucket, and is not burned.
 */
export function burnedOf(
    verdicts: readonly Verdict[],
    testPositions: ReadonlySet<string>,
    modulus: number = HELD_OUT_SPLIT_MODULUS
): Verdict[] {
    const sideOf = verdictSidesOf(verdicts, testPositions, modulus);
    const byHash = new Map(verdicts.map((v) => [verdictIdOf(v), v]));
    return verdicts.filter((v) => {
        if (v.source === "registry" || sideOf.get(v.id) !== "fit") return false;
        const unitAnchor = v.pairOf ? byHash.get(v.pairOf.anchorId) : v;
        return (
            unitAnchor !== undefined &&
            heldOutBucketOf(scenarioKeyOf(unitAnchor), modulus) === 0
        );
    });
}

/**
 * The Minimal Pairs the split refuses, by the right-hand half's verdict id
 * (`verdictIdOf`), each with its reason (ADR 0148 § Split).
 *
 * A half inherits its anchor's side instead of hashing its own board, so the
 * derived board can land beside a board someone ALREADY judged on the other
 * side — and the fit would then read, on one side, a position the held-out side
 * grades. "Nothing already assigned moves": the existing judgement keeps its
 * side and the pair is not formed, never re-sided. Reads each half's unit and
 * the verdicts sharing its scenario key, nothing else of the corpus.
 */
export function pairSplitRefusals(
    verdicts: readonly Verdict[],
    testPositions: ReadonlySet<string>,
    modulus: number = HELD_OUT_SPLIT_MODULUS
): Map<string, string> {
    const sideOf = verdictSidesOf(verdicts, testPositions, modulus);
    const byKey = new Map<string, Verdict[]>();
    for (const v of verdicts) {
        const key = scenarioKeyOf(v);
        byKey.set(key, [...(byKey.get(key) ?? []), v]);
    }
    const out = new Map<string, string>();
    for (const half of verdicts) {
        if (half.pairOf === undefined) continue;
        const side = sideOf.get(half.id);
        if (side === undefined) continue;
        const rival = (byKey.get(scenarioKeyOf(half)) ?? []).find(
            (other) =>
                other !== half && sideOf.get(other.id) === otherSide(side)
        );
        if (rival === undefined) continue;
        out.set(
            verdictIdOf(half),
            `the derived board is already judged by ${rival.id} on the ${otherSide(side)} side of the held-out split, while its anchor ${half.pairOf.anchorId} is ${side}-side — the pair is refused, never re-sided (ADR 0148)`
        );
    }
    return out;
}

/**
 * `pairSplitRefusals` for Promotion, which holds judgements rather than
 * Verdicts: the store's judgements beside the blade registry's Verdicts, which
 * are Test Positions by rule. Keyed by the judgement's verdict id (its content
 * hash, `verdictIdOf`). The side logic reads a scenario and a source, never an
 * author or a date, so the provenance filled in here is inert.
 */
export function judgementSplitRefusals(
    members: readonly { verdictId: string; judgement: VerdictJudgement }[],
    registry: readonly Verdict[],
    modulus: number = HELD_OUT_SPLIT_MODULUS
): Map<string, string> {
    const stored: Verdict[] = members.map((m) => ({
        ...m.judgement,
        id: m.verdictId,
        author: "",
        createdAt: "",
        source: "store",
    }));
    return pairSplitRefusals(
        [...registry, ...stored],
        new Set(registry.map(scenarioKeyOf)),
        modulus
    );
}

const otherSide = (side: VerdictSide): VerdictSide =>
    side === "fit" ? "held-out" : "fit";

/**
 * The Weight Fit's input: the Eval Pairs of `pairs` whose Verdict resolves
 * fit-side (`verdictSidesOf`). Throws on a pair whose Verdict's side is
 * unknown — not in `verdicts`, or a half without its anchor — so a pair of
 * unknown side is never let through to the fit.
 */
export function fitInputPairs(
    pairs: readonly EvalPair[],
    verdicts: readonly Verdict[],
    testPositions: ReadonlySet<string>,
    modulus: number = HELD_OUT_SPLIT_MODULUS
): EvalPair[] {
    const sideOf = verdictSidesOf(verdicts, testPositions, modulus);
    return pairs.filter((pair) => {
        const side = sideOf.get(pair.verdictId);
        if (side === undefined) {
            throw new Error(
                `Eval Pair of ${pair.verdictId}: its side of the held-out split is unknown (its Verdict, or its Minimal Pair anchor, is not in the corpus)`
            );
        }
        return side === "fit";
    });
}

/**
 * `report` restricted to the Verdicts of one side of the split (issue #5070):
 * rows, pairs and every classification of them. A contradiction stays only
 * when BOTH its pairs are on the side; a Verdict or pair of unknown side
 * (`verdictSidesOf` has no entry) belongs to neither. Gaps, errors and
 * incomplete entries carry through unchanged — they say what the corpus held,
 * not how a vector scores on it. Scoring the result (`scoreVerdictReport`)
 * therefore reads one side's Verdicts and nothing else.
 */
export function sideReportOf(
    report: VerdictReport,
    verdicts: readonly Verdict[],
    testPositions: ReadonlySet<string>,
    side: VerdictSide,
    modulus: number = HELD_OUT_SPLIT_MODULUS
): VerdictReport {
    const sideOf = verdictSidesOf(verdicts, testPositions, modulus);
    const onSide = (verdictId: string) => sideOf.get(verdictId) === side;
    const pairsOf = (pairs: readonly EvalPair[]) =>
        pairs.filter((p) => onSide(p.verdictId));
    const keep = new Set<EvalPair>(
        report.pairs.filter((p) => onSide(p.verdictId))
    );
    const contradictions = report.contradictions.filter(
        (c) => keep.has(c.a) && keep.has(c.b)
    );
    return {
        ...report,
        verdicts: verdicts.filter((v) => onSide(v.id)).length,
        rows: report.rows.filter((r) => onSide(r.verdictId)),
        pairs: pairsOf(report.pairs),
        satisfied: pairsOf(report.satisfied),
        violated: pairsOf(report.violated),
        contradictions,
        timing: pairsOf(report.timing),
        blind: pairsOf(report.blind),
    };
}
