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
};

/**
 * Run `verdict`'s position through `searchWithTrace` once per seed and count
 * the seeds on which the pick lands in the verdict's ALLOWED set (its right
 * candidates, or everything but its forbidden ones). The pick is matched to a
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
    const pairs = evalPairsOf(verdict);
    const timing = pairs.timing.length > 0;
    if (pairs.error !== undefined) {
        return { ...base, timing, error: pairs.error };
    }

    const named = new Set(
        verdict.answer.kind === "right"
            ? verdict.answer.rightIndexes
            : verdict.answer.forbiddenIndexes
    );
    const isAllowed = (i: number) =>
        verdict.answer.kind === "right" ? named.has(i) : !named.has(i);

    let agreed = 0;
    const picks: string[] = [];
    for (const seed of budget.seeds) {
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
        if (index >= 0 && isAllowed(index)) agreed++;
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
    rows: readonly VerdictSearchRow[],
    budgetLine: string
): string {
    const out: string[] = [
        `== verdicts through the search (issue #4764) — ${rows.length} verdicts, ${budgetLine}`,
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
    for (const cls of classes) {
        const subset = rows.filter((r) => r.class === cls);
        out.push(
            `  ${cls.padEnd(18)} : ${tally(subset)}  (${subset.length} verdicts)`
        );
    }

    out.push("\n== per verdict (agreed/seeds, T = timing)");
    for (const row of rows) {
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
