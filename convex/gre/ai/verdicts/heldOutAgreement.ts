// Held-out agreement (issue #3982, PRD #3980, ADR 0138, ADR 0148): how often
// the Bot answers as the player did, measured ONLY on the Verdicts the Weight
// Fit never read (`heldOut.ts`). Two measures, one shape:
//
//   - EVAL agreement: the share of held-out Eval Pairs the Evaluation orders as
//     the player did, printed beside the promotion report. Timing pairs (the
//     fit cannot order them, `evalPairs.ts`) and incomplete units (half a
//     Minimal Pair, never an argument, `report.ts`) are not agreement evidence:
//     they are excluded and counted on their own line.
//   - PICK agreement: `searchVerdict` over the held-out Verdicts (`searchAgreement.ts`
//     uses `heldOutVerdicts` below — a side filter, not a second runner).
//
// Both are aggregate + per Decision Class, each with its `n`, and flagged
// `indicative, not a claim` under `INDICATIVE_BELOW`: a share over fewer
// samples than that is a reading, not evidence of strength. A measurement
// only — it gates nothing in v1 (ADR 0143).
//
// Pure: reads a `VerdictReport` and a corpus, no engine of its own.

import { verdictDecisionClass } from "./coverage";
import { burnedOf, pairSplitRefusals, verdictSidesOf } from "./heldOut";
import { verdictIdOf } from "./identity";
import { SATISFIED_EPS, type VerdictReport } from "./report";
import type { Verdict } from "./types";

/** Under this many samples a share is "indicative, not a claim". */
export const INDICATIVE_BELOW = 100;

/** The Verdicts of `verdicts` on the held-out side of the split — the ONLY
 *  ones a held-out measure may read. A Verdict whose side is unknown (a
 *  Minimal Pair half without its anchor) is not on it. */
export function heldOutVerdicts(
    verdicts: readonly Verdict[],
    testPositions: ReadonlySet<string>
): Verdict[] {
    const sideOf = verdictSidesOf(verdicts, testPositions);
    // A Minimal Pair half the split refuses sits beside a board already judged
    // on the fit side (`pairSplitRefusals`): it is no held-out evidence.
    const refused = pairSplitRefusals(verdicts, testPositions);
    return verdicts.filter(
        (v) => sideOf.get(v.id) === "held-out" && !refused.has(verdictIdOf(v))
    );
}

/** The burned count (`burnedOf`) beside the held-out `n` it reduced. */
export type BurnedCount = {
    burned: number;
    /** Held-out Verdicts that remain (`heldOutVerdicts`). */
    heldOutN: number;
};

/** `burnedOf` and the held-out `n` it reduced — printed beside every
 *  agreement number (issue #3983). */
export function burnedCountOf(
    verdicts: readonly Verdict[],
    testPositions: ReadonlySet<string>
): BurnedCount {
    return {
        burned: burnedOf(verdicts, testPositions).length,
        heldOutN: heldOutVerdicts(verdicts, testPositions).length,
    };
}

/** The `burned` line of an agreement block. */
export function formatBurned({ burned, heldOutN }: BurnedCount): string {
    return `  burned             : ${burned} held-out positions admitted to the registry anyway (held-out n = ${heldOutN} remaining)`;
}

/** One tally: how many of `n` agreed. */
export type AgreementTally = { agreed: number; n: number };

export type HeldOutEvalAgreement = {
    aggregate: AgreementTally;
    /** Per Decision Class (`verdictDecisionClass`, `"unclassified"` when none),
     *  keyed in sorted order. */
    byClass: Record<string, AgreementTally>;
    /** Held-out timing pairs — excluded, they reach the same board either way. */
    excludedTiming: number;
    /** Held-out (or side-unknown) incomplete units — excluded, never an
     *  argument on their own. */
    excludedIncomplete: number;
    /** Held-out positions admitted to the registry anyway (issue #3983). */
    burned: BurnedCount;
};

/**
 * The held-out Eval Pairs of `report`, tallied: a pair agrees when the
 * Evaluation orders the judged candidate strictly above the other
 * (`SATISFIED_EPS`, the bar `VerdictRow.ok` uses — a tie is not agreement).
 * `report` must be the report of `verdicts`.
 */
export function heldOutEvalAgreement(
    report: Pick<VerdictReport, "pairs" | "timing" | "incomplete">,
    verdicts: readonly Verdict[],
    testPositions: ReadonlySet<string>
): HeldOutEvalAgreement {
    const sideOf = verdictSidesOf(verdicts, testPositions);
    const classOf = new Map(
        verdicts.map((v) => [v.id, verdictDecisionClass(v) ?? "unclassified"])
    );
    const isHeldOut = (verdictId: string) =>
        sideOf.get(verdictId) === "held-out";

    const aggregate: AgreementTally = { agreed: 0, n: 0 };
    const byClass = new Map<string, AgreementTally>();
    for (const pair of report.pairs) {
        if (!isHeldOut(pair.verdictId)) continue;
        const cls = classOf.get(pair.verdictId) ?? "unclassified";
        const tally = byClass.get(cls) ?? { agreed: 0, n: 0 };
        const agreed = pair.delta > SATISFIED_EPS ? 1 : 0;
        tally.agreed += agreed;
        tally.n++;
        aggregate.agreed += agreed;
        aggregate.n++;
        byClass.set(cls, tally);
    }
    return {
        aggregate,
        byClass: Object.fromEntries(
            [...byClass.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
        ),
        excludedTiming: report.timing.filter((p) => isHeldOut(p.verdictId))
            .length,
        // An incomplete unit's side may be unknown (its anchor is missing):
        // it is not fit-side evidence either way, so only a fit-side one is
        // left out of this count.
        excludedIncomplete: report.incomplete.filter(
            (u) => sideOf.get(u.verdictId) !== "fit"
        ).length,
        burned: burnedCountOf(verdicts, testPositions),
    };
}

/** `agreed/n (x.x%)`, with the `indicative` flag under `INDICATIVE_BELOW`. */
export function formatAgreementTally(tally: AgreementTally): string {
    if (tally.n === 0) return "— (n = 0, indicative, not a claim)";
    const share = `${tally.agreed}/${tally.n} (${((100 * tally.agreed) / tally.n).toFixed(1)}%)`;
    return tally.n < INDICATIVE_BELOW
        ? `${share}  n = ${tally.n}, indicative, not a claim`
        : `${share}  n = ${tally.n}`;
}

/** The held-out section of the Verdict report, printed by `verdicts:promote`. */
export function formatHeldOutEvalAgreement(
    agreement: HeldOutEvalAgreement
): string {
    const out = [
        "== held-out eval agreement (issue #3982) — pairs the Evaluation orders as the player did, held-out side only",
        formatBurned(agreement.burned),
        `  all                : ${formatAgreementTally(agreement.aggregate)}`,
        `  excluded           : ${agreement.excludedTiming} timing pairs, ${agreement.excludedIncomplete} incomplete units (not agreement evidence)`,
        "  by Decision Class",
    ];
    for (const [cls, tally] of Object.entries(agreement.byClass)) {
        out.push(`    ${cls.padEnd(16)} : ${formatAgreementTally(tally)}`);
    }
    return out.join("\n");
}
