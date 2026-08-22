// Ladder verdict engine (issue #1924, decision #1895 §4).
//
// The verdict is MECHANICAL — arithmetic on Wilson 95% intervals, computed by
// the script, never judgment. The three rules, verbatim from decision #1895:
//
//   IMPROVEMENT   aggregate CI entirely above 50% AND no matchup CI entirely
//                 below 50% → the change lands and its flag becomes default.
//   REGRESSION    aggregate CI entirely below 50% → the change does not land.
//   INCONCLUSIVE  aggregate CI straddles 50% → lands only with a declared
//                 non-strength justification ("strength-neutral" in the PR).
//
// Human/agent judgment enters only on drill-down (which matchup regressed →
// which dynamic broke → typically a new blade scenario). The Elo delta is
// informational only — never part of a rule.

import type { LadderGameRecord, LadderRunHeader } from "./plan";
import type { LadderPairing } from "./pairings";

/** Wilson score interval for a binomial proportion at confidence z. */
export type WilsonInterval = {
    rate: number;
    lo: number;
    hi: number;
    n: number;
};

const Z95 = 1.96;

export function wilson(wins: number, n: number, z = Z95): WilsonInterval {
    if (n === 0) return { rate: 0.5, lo: 0, hi: 1, n };
    const p = wins / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
    return {
        rate: p,
        lo: Math.max(0, center - half),
        hi: Math.min(1, center + half),
        n,
    };
}

/** Informational Elo delta for a win-rate (clamped away from 0/1 so a small
 *  perfect sample reads as a big-but-finite number, not Infinity). */
export function eloDelta(rate: number): number {
    const p = Math.min(0.999, Math.max(0.001, rate));
    return -400 * Math.log10(1 / p - 1);
}

export type LadderVerdict = "IMPROVEMENT" | "REGRESSION" | "INCONCLUSIVE";

export function computeVerdict(
    aggregate: WilsonInterval,
    matchups: WilsonInterval[]
): LadderVerdict {
    if (aggregate.lo > 0.5 && matchups.every((m) => m.hi >= 0.5))
        return "IMPROVEMENT";
    if (aggregate.hi < 0.5) return "REGRESSION";
    return "INCONCLUSIVE";
}

export type MatchupSummary = {
    pairingIndex: number;
    deckA: string;
    deckB: string;
    wins: number;
    losses: number;
    decisive: number;
    guardStops: number;
    ci: WilsonInterval;
};

export type LadderSummary = {
    games: number;
    decisive: number;
    guardStops: number;
    matchups: MatchupSummary[];
    aggregate: WilsonInterval;
    verdict: LadderVerdict;
};

/** Fold the game records into the per-matchup + aggregate report. Candidate
 *  win-rates are over DECISIVE games only; guard stops (candidateWon = null)
 *  are counted separately — harness health, never wins or losses.
 *
 * Order-independent over `records` (issue #2681): matchups are grouped by
 * the `pairingIndex` each record CARRIES — never by array position — and
 * only pairing indices that actually appear in `records` are reported. A
 * filtered run's records carry the SAME registry indices an unfiltered run
 * would (plan.ts: filterGamePlan preserves identity), so passing the full
 * `pairings` registry here (as `scripts/ladder.ts` always does) is correct
 * for both a full and a filtered run: excluded rows never contribute a
 * phantom 0/0 matchup, and record order — sequential vs. parallel-worker
 * completion order — never changes the summary. */
export function summarizeRun(
    records: LadderGameRecord[],
    pairings: LadderPairing[]
): LadderSummary {
    const present = Array.from(
        new Set(records.map((r) => r.pairingIndex))
    ).sort((a, b) => a - b);
    const matchups: MatchupSummary[] = present.map((i) => {
        const p = pairings[i];
        return {
            pairingIndex: i,
            deckA: p?.deckA ?? "?",
            deckB: p?.deckB ?? "?",
            wins: 0,
            losses: 0,
            decisive: 0,
            guardStops: 0,
            ci: wilson(0, 0),
        };
    });
    const byIndex = new Map(matchups.map((m) => [m.pairingIndex, m]));
    let wins = 0;
    let decisive = 0;
    let guardStops = 0;

    for (const r of records) {
        const m = byIndex.get(r.pairingIndex);
        if (!m) continue;
        if (r.candidateWon === null) {
            m.guardStops++;
            guardStops++;
            continue;
        }
        m.decisive++;
        decisive++;
        if (r.candidateWon) {
            m.wins++;
            wins++;
        } else {
            m.losses++;
        }
    }
    for (const m of matchups) m.ci = wilson(m.wins, m.decisive);
    const aggregate = wilson(wins, decisive);
    return {
        games: records.length,
        decisive,
        guardStops,
        matchups,
        aggregate,
        verdict: computeVerdict(
            aggregate,
            matchups.map((m) => m.ci)
        ),
    };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ciStr = (ci: WilsonInterval) =>
    `${pct(ci.rate)} [${pct(ci.lo)}–${pct(ci.hi)}]`;

/** The paste-ready markdown block for the PR — the durable record of the run
 *  (decision #1895 §4: the JSONL stays out of git, this block does not). */
export function formatVerdictBlock(
    summary: LadderSummary,
    header: LadderRunHeader
): string {
    const lines = [
        `### Ladder verdict: **${summary.verdict}**`,
        "",
        `- run: tier \`${header.tier}\` (${summary.games}/${header.totalGames} games), baseSeed \`${header.baseSeed}\`, ${header.iterations} iterations`,
        `- candidate: \`${header.variant ?? "control (null run)"}\` vs control`,
        `- aggregate: ${ciStr(summary.aggregate)} over ${summary.decisive} decisive games (Elo ${summary.aggregate.n > 0 ? eloDelta(summary.aggregate.rate).toFixed(0) : "n/a"}, informational)`,
        summary.guardStops > 0
            ? `- ⚠ guard stops: ${summary.guardStops} (excluded from win-rates — investigate)`
            : `- guard stops: 0`,
        "",
        "| matchup | candidate | win-rate [95% CI] |",
        "|---|---|---|",
        ...summary.matchups.map(
            (m) =>
                `| ${m.deckA} vs ${m.deckB} | ${m.wins}–${m.losses}` +
                `${m.guardStops ? ` (+${m.guardStops} stops)` : ""} | ${ciStr(m.ci)} |`
        ),
    ];
    return lines.join("\n");
}

/** One streamed line per game — the live output the 4h-silent corpus run of
 *  2026-07-29 taught us to never skip (decision #1895 §3). */
export function formatLiveLine(
    record: LadderGameRecord,
    played: number,
    total: number,
    running: WilsonInterval
): string {
    const winner =
        record.candidateWon === null
            ? `stop:${record.reason}`
            : record.candidateWon
              ? "candidate"
              : "control";
    return (
        `game ${String(played).padStart(String(total).length)}/${total}` +
        ` · ${record.deckSeat0} vs ${record.deckSeat1}` +
        ` · seed ${record.seed} · cand=${record.candidateSeat}` +
        ` · winner=${winner}` +
        ` · cand ${ciStr(running)} (n=${running.n})` +
        ` · ${(record.ms / 1000).toFixed(0)}s`
    );
}
