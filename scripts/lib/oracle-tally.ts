/**
 * The lockfile's tallies — derived from its rows on read, never committed
 * (ADR 0157 § 1a, issue #6244).
 *
 * `header.counts` and the per-format table used to be written into
 * `data/oracle-compiled.json`. They are a tally of the `cards` rows beside
 * them, so every PR that moved any card's compile state rewrote them and two
 * such PRs always conflicted textually. ONE derivation serves every reader
 * (`oracle-report`, `oracle-compile`'s summary, `check:oracle`) so they cannot
 * disagree about what a count is.
 */

import type { CompileState } from "../../convex/oracle/types";
import { REPORTED_FORMATS, type ReportedFormat } from "../oracle-corpus";
import type { CardRow, FormatRow } from "./oracle-lockfile";

export type CompileCounts = Record<CompileState, number> & {
    readonly total: number;
};

/** Rows → per-state tally plus the row total. */
export function deriveCounts(cards: readonly CardRow[]): CompileCounts {
    const counts = { ready: 0, quarantine: 0, unparsed: 0 };
    for (const card of cards) counts[card.state] += 1;
    return { ...counts, total: cards.length };
}

/**
 * Rows → per-format tally. A card counts toward a format when it is LEGAL
 * there: the row's `poolIn` (legal, banned or restricted) minus its
 * `bannedIn`. `pool` counts those whose oracle id has a hand-written
 * definition today — `poolOracleIds`, read from the card index by the caller
 * (the header's `poolHash` pins that set).
 */
export function deriveFormats(
    cards: readonly CardRow[],
    pool: ReadonlySet<string>
): Record<ReportedFormat, FormatRow> {
    const formats = Object.fromEntries(
        REPORTED_FORMATS.map((f) => [
            f,
            { total: 0, ready: 0, quarantine: 0, unparsed: 0, pool: 0 },
        ])
    ) as Record<ReportedFormat, { -readonly [K in keyof FormatRow]: number }>;
    for (const card of cards) {
        for (const format of card.poolIn ?? []) {
            if (card.bannedIn?.includes(format)) continue;
            const row = formats[format];
            row.total += 1;
            row[card.state] += 1;
            if (pool.has(card.oracleId)) row.pool += 1;
        }
    }
    return formats;
}
