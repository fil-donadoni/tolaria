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

/** McNemar-style paired interval over the ladder's own pairing design (issue
 *  #2779). A "pair" is the two orientations of one (pairingIndex, seedIndex):
 *  same seed, same shuffles, only which agent drives which seat differs
 *  (decision #1895 §3 — this is WHY `--orientations 2` exists at all). A pair
 *  is DISCORDANT when the candidate takes both orientations (a sweep FOR) or
 *  drops both (a sweep AGAINST) — those are the only pairs that carry
 *  information about candidate vs. control. A CONCORDANT pair (1-1: the same
 *  deck wins regardless of who is driving it) cancels identically under any
 *  true effect and contributes nothing but noise if folded into an
 *  independent-trials estimate — which is exactly what `wilson()` over raw
 *  games does, and why it reads wider than this interval on the same data.
 *
 *  Deviation from 50% is exactly (sweepsFor − sweepsAgainst) / (2·pairs); a
 *  discordant pair resolves one way or the other with probability 1/2 under
 *  the null, so the win-rate SD is 2·sqrt(discordant/4) / (2·pairs), i.e.
 *  sqrt(discordant) / (2·pairs) below.
 *
 *  A pair whose partner game is missing — a guard stop on one side, or a
 *  resumed/filtered run that never played it — is EXCLUDED from the
 *  statistic, never folded in as a half-pair, and reported separately so an
 *  incomplete run is still judgeable (not silently biased). */
export type PairedInterval = {
    rate: number;
    lo: number;
    hi: number;
    /** Complete decisive pairs the statistic is built from. */
    pairs: number;
    /** 1-1 pairs — uninformative, excluded from the SD (not from `pairs`). */
    concordant: number;
    /** 2-0 + 0-2 pairs — sweepsFor + sweepsAgainst; all the signal lives here. */
    discordant: number;
    sweepsFor: number;
    sweepsAgainst: number;
    /** Pairs with a missing/guard-stopped partner — dropped, not folded in. */
    excludedPairs: number;
};

export function pairedAggregate(
    records: LadderGameRecord[],
    z = Z95
): PairedInterval {
    const bySeed = new Map<string, Partial<Record<0 | 1, LadderGameRecord>>>();
    for (const r of records) {
        const key = `${r.pairingIndex}:${r.seedIndex}`;
        const slot = bySeed.get(key) ?? {};
        slot[r.orientation] = r;
        bySeed.set(key, slot);
    }

    let pairs = 0;
    let concordant = 0;
    let sweepsFor = 0;
    let sweepsAgainst = 0;
    let excludedPairs = 0;

    for (const slot of bySeed.values()) {
        const g0 = slot[0];
        const g1 = slot[1];
        if (
            !g0 ||
            !g1 ||
            g0.candidateWon === null ||
            g1.candidateWon === null
        ) {
            excludedPairs++;
            continue;
        }
        pairs++;
        if (g0.candidateWon === g1.candidateWon) {
            if (g0.candidateWon) sweepsFor++;
            else sweepsAgainst++;
        } else {
            concordant++;
        }
    }

    const discordant = sweepsFor + sweepsAgainst;
    const totalGames = pairs * 2;
    if (totalGames === 0) {
        return {
            rate: 0.5,
            lo: 0,
            hi: 1,
            pairs,
            concordant,
            discordant,
            sweepsFor,
            sweepsAgainst,
            excludedPairs,
        };
    }
    const rate = 0.5 + (sweepsFor - sweepsAgainst) / totalGames;
    const half = (z * Math.sqrt(discordant)) / totalGames;
    return {
        rate,
        lo: Math.max(0, rate - half),
        hi: Math.min(1, rate + half),
        pairs,
        concordant,
        discordant,
        sweepsFor,
        sweepsAgainst,
        excludedPairs,
    };
}

export type LadderVerdict =
    | "IMPROVEMENT"
    | "REGRESSION"
    | "INCONCLUSIVE"
    /** orientations:1 corpus-mode run — there is no candidate reading to
     *  verdict on (the "candidate" label sits on one fixed seat in every
     *  game, so its rate is the seat advantage, not a strength signal). */
    | "NO_VERDICT";

/** Minimal shape `computeVerdict` needs from its aggregate — both
 *  `WilsonInterval` and `PairedInterval` satisfy it, so the SAME decision
 *  rule (decision #1895 §4) runs unchanged over either. */
type VerdictInterval = { lo: number; hi: number };

export function computeVerdict(
    aggregate: VerdictInterval,
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
    /** S0-seat wins for this matchup, independent of which side carries the
     *  "candidate" label — the reading `formatVerdictBlock` renders in the
     *  matchup table on a NO_VERDICT (orientations:1) run, so the table
     *  never presents a fixed-seat rate as a candidate result (issue #2779
     *  review finding 2). */
    seatWins: number;
    seatCI: WilsonInterval;
};

export type LadderSummary = {
    games: number;
    decisive: number;
    guardStops: number;
    matchups: MatchupSummary[];
    /** Unpaired Wilson interval over every decisive game as an independent
     *  trial — kept alongside `paired` so the two stay comparable in the
     *  report during the transition (issue #2779). Never used for the
     *  verdict when a paired reading is available. */
    aggregate: WilsonInterval;
    /** Paired McNemar-style interval (issue #2779) — the verdict's aggregate
     *  whenever the run has at least one complete pair. `pairs === 0` on an
     *  orientations:1 corpus-mode run (no partner orientation ever played)
     *  or a run with no complete pair at all. */
    paired: PairedInterval;
    /** S0 seat win-rate over decisive games, independent of which side the
     *  "candidate" label sits on — the orientations:1 reading (issue #2779):
     *  a single-orientation run's aggregate rate IS the seat rate, which
     *  reads as a candidate verdict but isn't one. */
    seatCI: WilsonInterval;
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
 * completion order — never changes the summary.
 *
 * `header` supplies `orientations` (issue #2779): an orientations:1 run gets
 * `NO_VERDICT` unconditionally (there is no candidate reading — see
 * `seatCI`); an orientations:2 run's verdict keys off the PAIRED aggregate
 * whenever it has at least one complete pair, and falls back to the
 * unpaired Wilson aggregate only when it has none (e.g. every pair in a
 * resumed/filtered run is incomplete) — so a broken pairing is never
 * silently judged as if it were whole. */
export function summarizeRun(
    records: LadderGameRecord[],
    pairings: LadderPairing[],
    header: Pick<LadderRunHeader, "orientations">
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
            seatWins: 0,
            seatCI: wilson(0, 0),
        };
    });
    const byIndex = new Map(matchups.map((m) => [m.pairingIndex, m]));
    let wins = 0;
    let decisive = 0;
    let guardStops = 0;
    let s0Wins = 0;

    for (const r of records) {
        const m = byIndex.get(r.pairingIndex);
        if (r.candidateWon === null) {
            if (m) m.guardStops++;
            guardStops++;
            continue;
        }
        if (m) {
            m.decisive++;
            if (r.candidateWon) m.wins++;
            else m.losses++;
            if (r.winnerSeat === "S0") m.seatWins++;
        }
        decisive++;
        if (r.candidateWon) wins++;
        if (r.winnerSeat === "S0") s0Wins++;
    }
    for (const m of matchups) {
        m.ci = wilson(m.wins, m.decisive);
        m.seatCI = wilson(m.seatWins, m.decisive);
    }
    const aggregate = wilson(wins, decisive);
    const seatCI = wilson(s0Wins, decisive);
    const paired = pairedAggregate(records);

    const orientations = header.orientations ?? 2;
    const verdict: LadderVerdict =
        orientations === 1
            ? "NO_VERDICT"
            : computeVerdict(
                  paired.pairs > 0 ? paired : aggregate,
                  matchups.map((m) => m.ci)
              );

    return {
        games: records.length,
        decisive,
        guardStops,
        matchups,
        aggregate,
        paired,
        seatCI,
        verdict,
    };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ciStr = (ci: { rate: number; lo: number; hi: number }) =>
    `${pct(ci.rate)} [${pct(ci.lo)}–${pct(ci.hi)}]`;

/** The paste-ready markdown block for the PR — the durable record of the run
 *  (decision #1895 §4: the JSONL stays out of git, this block does not).
 *
 *  Both `paired` and `unpaired` are always printed on a candidate run (issue
 *  #2779) so the two stay comparable across runs during the transition; the
 *  line note says which one the verdict actually used. An orientations:1
 *  corpus-mode run prints no candidate verdict at all — only the seat
 *  reading, which is what its single-orientation aggregate rate actually is
 *  (decision #1895 §3, issue #1929). */
export function formatVerdictBlock(
    summary: LadderSummary,
    header: LadderRunHeader
): string {
    const noVerdict = summary.verdict === "NO_VERDICT";
    const usedPaired = !noVerdict && summary.paired.pairs > 0;

    const lines = [
        noVerdict
            ? `### Ladder verdict: no candidate verdict — corpus mode, single orientation`
            : `### Ladder verdict: **${summary.verdict}**`,
        "",
        `- run: tier \`${header.tier}\` (${summary.games}/${header.totalGames} games), baseSeed \`${header.baseSeed}\`, ${header.iterations} iterations`,
        `- candidate: \`${header.variant ?? "control (null run)"}\` vs control`,
    ];

    if (noVerdict) {
        lines.push(
            `- S0 win rate: ${ciStr(summary.seatCI)} over ${summary.decisive} decisive games (seat advantage — orientations:1 never establishes a candidate reading)`
        );
    } else {
        lines.push(
            `- paired: ${ciStr(summary.paired)} over ${summary.paired.pairs} pairs` +
                ` (${summary.paired.discordant} discordant: ${summary.paired.sweepsFor} for / ${summary.paired.sweepsAgainst} against,` +
                ` ${summary.paired.concordant} concordant` +
                (summary.paired.excludedPairs > 0
                    ? `, ${summary.paired.excludedPairs} excluded`
                    : "") +
                `)${usedPaired ? " — used for the verdict" : ""}`,
            `- unpaired: ${ciStr(summary.aggregate)} over ${summary.decisive} decisive games (Elo ${summary.aggregate.n > 0 ? eloDelta(summary.aggregate.rate).toFixed(0) : "n/a"}, informational)${!usedPaired ? " — used for the verdict" : ""}`
        );
    }

    // NO_VERDICT (orientations:1, corpus mode): the "candidate" label sits
    // on one fixed seat in every game, so a per-matchup rate keyed off
    // candidateWon is a SEAT rate wearing a candidate label — precisely the
    // misreading this mode exists to remove from the aggregate line above
    // (issue #2779 review finding 2). Render the seat reading instead, and
    // relabel the column so nobody scans it as a candidate result.
    lines.push(
        summary.guardStops > 0
            ? `- ⚠ guard stops: ${summary.guardStops} (excluded from win-rates — investigate)`
            : `- guard stops: 0`,
        "",
        noVerdict
            ? "| matchup | S0 seat | win-rate [95% CI] |"
            : "| matchup | candidate | win-rate [95% CI] |",
        "|---|---|---|",
        ...summary.matchups.map((m) =>
            noVerdict
                ? `| ${m.deckA} vs ${m.deckB} | ${m.seatWins}–${m.decisive - m.seatWins}` +
                  `${m.guardStops ? ` (+${m.guardStops} stops)` : ""} | ${ciStr(m.seatCI)} |`
                : `| ${m.deckA} vs ${m.deckB} | ${m.wins}–${m.losses}` +
                  `${m.guardStops ? ` (+${m.guardStops} stops)` : ""} | ${ciStr(m.ci)} |`
        )
    );
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
