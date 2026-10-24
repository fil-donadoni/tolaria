/**
 * The Bot-play verdicts a rebased commit brought, kept through a lockfile
 * conflict (issue #5814).
 *
 * `merge-driver-regenerated.ts` resolves a conflicted generated artifact by
 * taking OURS (the base side, during a rebase) and leaving the bytes to the
 * resolver's regeneration at the rebased tip. For `data/oracle-compiled.json`
 * that regeneration is `oracle:compile --carry-bot`, which never plays: it
 * carries the verdicts of the lockfile IN THE TREE — the base's. A PR whose
 * point was a fresh verdict (`--carry-bot --replay-card <name>`, the remedy
 * every `never-chosen` Bot Gap names) therefore landed without it: PR #5752
 * replayed Stasis to `played`, the landed tree still read `ignored`, and the
 * gap re-filed itself twenty minutes later as issue #5814.
 *
 * The overlay is what the driver writes instead of bare OURS: OURS with every
 * card row whose verdict the commit CHANGED (theirs vs base) taken from
 * theirs. The resolver's `--carry-bot` then carries those rows like any other
 * — as played only where the row's definition matches what the rebased tree
 * compiles; a verdict measured on a definition the merge moved is carried
 * marked `botStale` (ADR 0158 § 2a), for the base to replay, never
 * misattributed. The file written here is an
 * intermediate: the regeneration rewrites every byte of it.
 */
import type { CardRow, Lockfile } from "./oracle-lockfile";

/** The one regenerated artifact this overlay applies to, repo-relative. */
export const BOT_VERDICT_OVERLAY_PATH = "data/oracle-compiled.json";

/** A row's verdict — its `botStale` marker included, so a commit that
 *  REPLAYED a carried verdict to the same outcome still counts as a change
 *  (issue #6688). A theirs row that is itself `botStale` never does: it
 *  carried the committed verdict and measured nothing, and substituting it
 *  would overwrite a verdict the base has since replayed. */
function verdictOf(row: CardRow | undefined): string {
    return row === undefined
        ? ""
        : `${row.botReach ?? ""}\u0000${row.botGap ?? ""}\u0000${row.botStale === true ? "stale" : ""}`;
}

/**
 * OURS, with each theirs row whose Bot verdict differs from base's row for
 * the same card substituted in. `carried` counts the substituted rows; an
 * unreadable base (`null`) substitutes none.
 */
export function overlayBranchVerdicts(
    base: Lockfile | null,
    ours: Lockfile,
    theirs: Lockfile
): { readonly lock: Lockfile; readonly carried: number } {
    // No base, no way to tell what the commit CHANGED from what it merely
    // inherited — an inherited stale verdict must not overwrite OURS.
    if (base === null) return { lock: ours, carried: 0 };
    const baseRows = new Map(
        base.cards.map((row) => [row.oracleId, row] as const)
    );
    const changed = new Map<string, CardRow>();
    for (const row of theirs.cards) {
        if (row.botReach === undefined || row.botStale === true) continue;
        if (verdictOf(row) === verdictOf(baseRows.get(row.oracleId))) continue;
        changed.set(row.oracleId, row);
    }
    if (changed.size === 0) return { lock: ours, carried: 0 };
    const cards = ours.cards.map((row) => changed.get(row.oracleId) ?? row);
    const present = new Set(ours.cards.map((row) => row.oracleId));
    for (const [oracleId, row] of changed)
        if (!present.has(oracleId)) cards.push(row);
    return { lock: { ...ours, cards }, carried: changed.size };
}
