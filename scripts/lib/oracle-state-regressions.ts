/**
 * The lockfile STATE-REGRESSION guard (issue #2696).
 *
 * The compiler's pool only ever grows by accident. A grammar rule generalised,
 * a Mechanics Registry status flipped, a smoke scenario tightened — each is a
 * one-line change that can move a card from `ready` back to `quarantine` or
 * `unparsed`, and the lockfile is 35,000 rows, so nobody reads the diff closely
 * enough to notice. The pool then shrinks silently and a deck that was 100%
 * stops being 100% with no red anywhere.
 *
 * So: a card that was `ready` must still be `ready`, or the PR must say why.
 *
 * Pure. The comparison is a function of two lockfile card arrays and a ledger,
 * with no filesystem and no git in it, because the guard's own proof has to be
 * a fixture — a guard whose only evidence is "it did not fire on the tree we
 * happen to have" is a guard nobody has ever seen work.
 */

import type { CardRow } from "./oracle-lockfile";

/** Path of the acknowledgement ledger, relative to the repo root. */
export const REGRESSION_LEDGER_PATH = "data/oracle-state-regressions.json";

/**
 * A row that has fallen out of `ready`.
 *
 * `absent` is its own destination: a card whose row disappeared entirely is
 * just as unplayable as one that went `unparsed`, and folding the two would let
 * a corpus re-pin that drops rows slip through as "no state change".
 */
export interface ReadyRegression {
    readonly oracleId: string;
    readonly name: string;
    readonly to: CardRow["state"] | "absent";
}

export interface RegressionAcknowledgement {
    readonly oracleId: string;
    readonly name: string;
    /** Why the pool is allowed to shrink here. Free text, read by review. */
    readonly reason: string;
    /** The issue that will undo it, when there is one. */
    readonly issue?: string;
}

export interface RegressionLedger {
    readonly acknowledged: readonly RegressionAcknowledgement[];
}

export function emptyRegressionLedger(): RegressionLedger {
    return { acknowledged: [] };
}

export function parseRegressionLedger(
    text: string,
    path = REGRESSION_LEDGER_PATH
): RegressionLedger {
    let doc: RegressionLedger;
    try {
        doc = JSON.parse(text) as RegressionLedger;
    } catch (err) {
        throw new Error(`${path} does not parse: ${(err as Error).message}`);
    }
    if (!Array.isArray(doc.acknowledged))
        throw new Error(`${path}: \`acknowledged\` must be an array`);
    for (const entry of doc.acknowledged) {
        if (typeof entry.oracleId !== "string" || entry.oracleId.length === 0)
            throw new Error(`${path}: an entry has no \`oracleId\``);
        if (
            typeof entry.reason !== "string" ||
            entry.reason.trim().length === 0
        )
            throw new Error(
                `${path}: \`${entry.name ?? entry.oracleId}\` has no \`reason\` — ` +
                    `an acknowledgement whose only content is a card id explains nothing`
            );
    }
    return doc;
}

/**
 * Every card that was `ready` in `baseline` and is not `ready` now.
 *
 * Only that direction. `unparsed` → `ready` is the whole point of the project,
 * `quarantine` → `unparsed` is a grammar detail nobody needs a gate for, and a
 * guard that fired on those would be turned off within a week.
 */
export function readyRegressions(
    baseline: readonly CardRow[],
    current: readonly CardRow[]
): ReadyRegression[] {
    const now = new Map(current.map((row) => [row.oracleId, row]));
    const out: ReadyRegression[] = [];
    for (const row of baseline) {
        if (row.state !== "ready") continue;
        const after = now.get(row.oracleId);
        if (after === undefined) {
            out.push({ oracleId: row.oracleId, name: row.name, to: "absent" });
        } else if (after.state !== "ready") {
            out.push({
                oracleId: row.oracleId,
                name: after.name,
                to: after.state,
            });
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The regressions the ledger does NOT cover — the ones that red the gate.
 *
 * An entry matches by `oracleId` alone, not by destination state: the
 * acknowledgement is "this card is allowed to leave the pool in this change",
 * and pinning it to `unparsed` rather than `quarantine` would make the author
 * re-edit the ledger every time they touched the grammar around it, for no
 * extra safety.
 *
 * An entry matching NOTHING is inert, deliberately. Acknowledgements are
 * per-change: once the regression lands on the base branch it is part of the
 * baseline, every later PR sees no regression at all, and a guard that red on
 * the leftover entry would red for authors who touched nothing. They are
 * reported as stale so they get cleaned up, never as a failure.
 */
export function unacknowledgedRegressions(
    regressions: readonly ReadyRegression[],
    ledger: RegressionLedger
): ReadyRegression[] {
    const acked = new Set(ledger.acknowledged.map((a) => a.oracleId));
    return regressions.filter((r) => !acked.has(r.oracleId));
}

/** Ledger entries that match no current regression — cleanup, not a failure. */
export function staleAcknowledgements(
    regressions: readonly ReadyRegression[],
    ledger: RegressionLedger
): RegressionAcknowledgement[] {
    const live = new Set(regressions.map((r) => r.oracleId));
    return ledger.acknowledged.filter((a) => !live.has(a.oracleId));
}

/** The failure message, so the guard's wiring holds no prose of its own. */
export function regressionMessage(
    unacknowledged: readonly ReadyRegression[]
): string {
    return (
        `${unacknowledged.length} card(s) left the \`ready\` pool since the base branch.\n` +
        `    The compiled pool must not shrink by accident — a deck that was 100% would\n` +
        `    stop being 100% with no other red anywhere:\n` +
        unacknowledged
            .map((r) => `    - ${r.name} (${r.oracleId}) ready -> ${r.to}`)
            .join("\n") +
        `\n\n    If the loss is intended, acknowledge each one in ${REGRESSION_LEDGER_PATH}\n` +
        `    with a \`reason\` (and an \`issue\` when one will undo it).`
    );
}
