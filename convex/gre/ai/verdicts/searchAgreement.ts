// Verdicts through the REAL search (issue #4764, PRD #4754) — `bun run
// verdicts:search`.
//
// The Eval Pair report asks whether the EVALUATION orders a verdict's
// candidates. Some verdicts it never can: a timing pair (`evalPairs.ts`
// header) reaches the same board either way, so it leaves the fit and is
// "checked by the search". This is that check, and it is run over the whole
// corpus rather than the timing verdicts alone, so the timing class is read
// beside every other class instead of in isolation.
//
// Deterministic by the blade contract: a fixed `iterations` budget (never
// wall-clock) and explicit seeds, the position rebuilt per seed through the
// same builder the pairs use. Report-only — never a gate: agreement below one
// is a measurement, and the verdicts it names are what a root rule or a term
// has to answer for.

import { moveKey, searchWithTrace } from "../../search";
import type { Move } from "../../moves";
import type { GameState } from "../../state";
import { makeInterchangeableKeyer } from "../interchangeable";
import { bladeDeckKnowledge } from "../blade/runner";
import { seatPlayerId } from "../blade/matcher";
import { describeMove } from "../../describeMove";
import { buildVerdictState, scenarioOfVerdict } from "./position";
import { evalPairsOf, resolveVerdictMoves } from "./evalPairs";
import { verdictDecisionClass } from "./coverage";
import {
    formatAgreementTally,
    formatBurned,
    heldOutVerdicts,
    type AgreementTally,
    type BurnedCount,
} from "./heldOutAgreement";
import { agreesWithVerdict, isIndifferent } from "./grade";
import type { Verdict } from "./types";

export type VerdictSearchBudget = { iterations: number; seeds: number[] };

/** One verdict, searched. */
export type VerdictSearchRow = {
    verdictId: string;
    /** The class the verdict teaches (`verdictDecisionClass`), or
     *  `"unclassified"`. */
    class: string;
    /** Whether any of its pairs is a TIMING pair — the class the search, not
     *  the fit, is answerable for. */
    timing: boolean;
    /** Seeds the search picked an allowed candidate on. */
    agreed: number;
    seeds: number;
    /** What the search picked on each seed, as the describer reads it. */
    picks: string[];
    /** Set when the verdict could not be searched at all. */
    error?: string;
    /** Set when the verdict is graded Indifferent (`grade.ts`): it carries no
     *  weight, so it is not searched (`seeds` 0) and every tally leaves it
     *  out, counting it on its own line. */
    indifferent?: true;
};

/**
 * Run `verdict`'s position through `searchWithTrace` once per seed and count
 * the seeds on which the pick AGREES (`agreesWithVerdict`): an allowed
 * candidate (its right candidates, or everything but its forbidden ones), or
 * an alternative its Preferred grade accepts. An Indifferent verdict is not
 * searched: its row says so and holds no seed. The pick is matched to a
 * candidate by structural key, then by interchangeability — the same two
 * steps `evalPairsOf` resolves a candidate with, so an allowed copy of a card
 * counts whichever twin the search happened to take.
 */
export function searchVerdict(
    verdict: Verdict,
    budget: VerdictSearchBudget
): VerdictSearchRow {
    const cls = verdictDecisionClass(verdict) ?? "unclassified";
    const base = {
        verdictId: verdict.id,
        class: cls,
        agreed: 0,
        seeds: budget.seeds.length,
        picks: [] as string[],
    };
    if (isIndifferent(verdict)) {
        return { ...base, seeds: 0, timing: false, indifferent: true };
    }
    const pairs = evalPairsOf(verdict);
    const timing = pairs.timing.length > 0;
    if (pairs.error !== undefined) {
        return { ...base, timing, error: pairs.error };
    }

    let agreed = 0;
    const picks: string[] = [];
    const seedList = budget.seeds;
    for (let i = 0; i < seedList.length; i++) {
        const seed = seedList[i];
        const state = buildVerdictState(verdict);
        const botId = seatPlayerId(state, verdict.seat);
        const resolved = resolveVerdictMoves(verdict, state, botId);
        if ("error" in resolved) {
            return { ...base, timing, error: resolved.error };
        }
        const { move } = searchWithTrace(
            state,
            botId,
            { iterations: budget.iterations },
            seed,
            bladeDeckKnowledge(state, scenarioOfVerdict(verdict))
        );
        picks.push(move ? describeMove(move, state) : "(no move)");
        const index = move ? candidateIndexOf(state, resolved.moves, move) : -1;
        if (index >= 0 && agreesWithVerdict(verdict, index)) agreed++;
    }
    return { ...base, timing, agreed, picks };
}

function candidateIndexOf(
    state: GameState,
    moves: readonly Move[],
    picked: Move
): number {
    const key = moveKey(picked);
    const exact = moves.findIndex((m) => moveKey(m) === key);
    if (exact >= 0) return exact;
    const collapse = makeInterchangeableKeyer(state);
    const pickedCollapsed = collapse(picked);
    return moves.findIndex((m) => collapse(m) === pickedCollapsed);
}

/** Agreement per verdict, then per class, then the timing class beside the
 *  rest — the table the PR of a root rule quotes before and after. */
export function formatVerdictSearchReport(
    allRows: readonly VerdictSearchRow[],
    budgetLine: string
): string {
    // An Indifferent verdict carries no weight: listed, never tallied.
    const indifferent = allRows.filter((r) => r.indifferent === true).length;
    const rows = allRows.filter((r) => r.indifferent !== true);
    const out: string[] = [
        `== verdicts through the search (issue #4764) — ${rows.length} verdicts, ${budgetLine}`,
        `  indifferent        : ${indifferent} verdicts graded Indifferent, not searched (no weight, outside every count)`,
    ];
    const ratio = (a: number, s: number) =>
        s === 0 ? "—" : `${a}/${s} (${((100 * a) / s).toFixed(1)}%)`;
    const tally = (subset: readonly VerdictSearchRow[]) => {
        const ok = subset.filter((r) => r.error === undefined);
        return ratio(
            ok.reduce((n, r) => n + r.agreed, 0),
            ok.reduce((n, r) => n + r.seeds, 0)
        );
    };

    out.push(`  all                : ${tally(rows)}`);
    out.push(`  timing             : ${tally(rows.filter((r) => r.timing))}`);
    out.push(`  everything else    : ${tally(rows.filter((r) => !r.timing))}`);
    const classes = [...new Set(rows.map((r) => r.class))].sort();
    out.push("\n== by class (seed agreement)");
    for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        const subset = rows.filter((r) => r.class === cls);
        out.push(
            `  ${cls.padEnd(18)} : ${tally(subset)}  (${subset.length} verdicts)`
        );
    }

    out.push("\n== per verdict (agreed/seeds, T = timing, IND = Indifferent)");
    for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        if (row.indifferent === true) {
            out.push(`    IND   ${row.verdictId}`);
            continue;
        }
        const mark = row.timing ? "T" : " ";
        if (row.error !== undefined) {
            out.push(`  ERR ${mark} ${row.verdictId}: ${row.error}`);
            continue;
        }
        out.push(
            `  ${`${row.agreed}/${row.seeds}`.padStart(5)} ${mark} ${row.verdictId}`
        );
        if (row.agreed < row.seeds) {
            out.push(`          picks: ${row.picks.join(" | ")}`);
        }
    }
    return out.join("\n");
}

/**
 * Pick agreement on the held-out side (issue #3982): `searchVerdict` over the
 * Verdicts the Weight Fit never read, and only those — the side filter
 * (`heldOutVerdicts`) runs BEFORE any search, so a fit-side Verdict costs
 * nothing and cannot enter the number. `search` is a port for the test that
 * proves it.
 */
export function searchHeldOutVerdicts(
    verdicts: readonly Verdict[],
    testPositions: ReadonlySet<string>,
    budgetOf: (verdict: Verdict) => VerdictSearchBudget,
    search: (
        verdict: Verdict,
        budget: VerdictSearchBudget
    ) => VerdictSearchRow = searchVerdict
): VerdictSearchRow[] {
    return heldOutVerdicts(verdicts, testPositions).map((v) =>
        search(v, budgetOf(v))
    );
}

/** Why a held-out run is no receipt (issue #8698), or `[]` when it is: the
 *  `verdicts:pick-agreement` runner fails on any line, so a run that exits 0
 *  searched at least one verdict and could search every one of them — its
 *  block is the held-out receipt a strength claim owes (ADR 0138). Agreement
 *  itself is never a refusal: the number is a reading, not a gate. */
export function heldOutReceiptRefusals(
    rows: readonly VerdictSearchRow[]
): string[] {
    // An Indifferent row was never searched: a split of nothing else
    // measures nothing either.
    if (rows.every((r) => r.indifferent === true))
        return [
            "no held-out verdict was searched — an empty split measures nothing",
        ];
    return rows
        .filter((r) => r.error !== undefined)
        .map((r) => `unsearchable: ${r.verdictId} — ${r.error}`);
}

/** Held-out pick agreement: aggregate and per Decision Class, each over `n`
 *  searched VERDICTS (a verdict that could not be searched is not one) with the
 *  seed tally beside it, flagged `indicative` under `INDICATIVE_BELOW`. Timing
 *  verdicts stay in — the search, not the fit, is answerable for them — and are
 *  read on their own line. */
export function formatHeldOutPickAgreement(
    rows: readonly VerdictSearchRow[],
    budgetLine: string,
    burned: BurnedCount
): string {
    // An Indifferent verdict is outside the denominator, counted on its line.
    const indifferent = rows.filter((r) => r.indifferent === true).length;
    const graded = rows.filter((r) => r.indifferent !== true);
    const searched = graded.filter((r) => r.error === undefined);
    // A verdict agrees when the search picked an agreeing candidate (allowed,
    // or an accepted alternative) on every seed; the seed-level share is
    // printed beside it.
    const verdictTally = (subset: readonly VerdictSearchRow[]): string => {
        const t: AgreementTally = {
            agreed: subset.filter((r) => r.agreed === r.seeds).length,
            n: subset.length,
        };
        const seeds = subset.reduce((n, r) => n + r.seeds, 0);
        const seedsAgreed = subset.reduce((n, r) => n + r.agreed, 0);
        return `${formatAgreementTally(t)}  [seeds ${seedsAgreed}/${seeds}]`;
    };
    const out = [
        `== held-out pick agreement (issue #3982) — verdicts whose every seed picked an allowed candidate or an accepted alternative, held-out side only, ${budgetLine}`,
        formatBurned(burned),
        `  all                : ${verdictTally(searched)}`,
        `  timing             : ${verdictTally(searched.filter((r) => r.timing))}`,
        `  everything else    : ${verdictTally(searched.filter((r) => !r.timing))}`,
        `  unsearchable       : ${graded.length - searched.length} verdicts (errors, not agreement evidence)`,
        `  indifferent        : ${indifferent} verdicts graded Indifferent (no weight, outside the denominator)`,
        "  by Decision Class",
    ];
    const clsList = [...new Set(searched.map((r) => r.class))].sort();
    for (let i = 0; i < clsList.length; i++) {
        const cls = clsList[i];
        out.push(
            `    ${cls.padEnd(16)} : ${verdictTally(searched.filter((r) => r.class === cls))}`
        );
    }
    return out.join("\n");
}
