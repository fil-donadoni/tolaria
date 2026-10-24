/**
 * The `ready` delta between two Oracle lockfiles, per set and across the
 * corpus — what `bun run oracle:report --delta [<ref>]` prints, and the number
 * a compiler change owes its PR (PRD issue #3820: "every rule lands with its
 * measured effect").
 *
 * Pure over in-memory rows so the arithmetic has a unit test; the script owns
 * reading the baseline out of git and the sets out of `data/json/`.
 */

import type { CardRow } from "./oracle-lockfile";
import { classifyVerdict } from "./oracle-bot-reach";

/** One set's membership, by Scryfall oracle id (MTGJSON `scryfallOracleId`). */
export interface SetMembership {
    readonly code: string;
    readonly oracleIds: ReadonlySet<string>;
}

export interface ReadyDeltaRow {
    /** A set code, or `"corpus"`. */
    readonly scope: string;
    readonly before: number;
    readonly after: number;
    /** Names that reached `ready`, sorted. */
    readonly gained: readonly string[];
    /** Names that were `ready` and are no longer, sorted. */
    readonly lost: readonly string[];
}

function readyIds(rows: readonly CardRow[]): Map<string, string> {
    const ready = new Map<string, string>();
    for (const row of rows)
        if (row.state === "ready") ready.set(row.oracleId, row.name);
    return ready;
}

function row(
    scope: string,
    before: ReadonlyMap<string, string>,
    after: ReadonlyMap<string, string>,
    within: (oracleId: string) => boolean
): ReadyDeltaRow {
    const gained: string[] = [];
    const lost: string[] = [];
    let beforeCount = 0;
    let afterCount = 0;
    for (const [id, name] of before) {
        if (!within(id)) continue;
        beforeCount++;
        if (!after.has(id)) lost.push(name);
    }
    for (const [id, name] of after) {
        if (!within(id)) continue;
        afterCount++;
        if (!before.has(id)) gained.push(name);
    }
    return {
        scope,
        before: beforeCount,
        after: afterCount,
        gained: gained.sort(),
        lost: lost.sort(),
    };
}

/** One row per set (in the order given), then the corpus row. */
export function readyDelta(
    before: readonly CardRow[],
    after: readonly CardRow[],
    sets: readonly SetMembership[]
): ReadyDeltaRow[] {
    const b = readyIds(before);
    const a = readyIds(after);
    return [
        ...sets.map((set) =>
            row(set.code, b, a, (id) => set.oracleIds.has(id))
        ),
        row("corpus", b, a, () => true),
    ];
}

function signed(n: number): string {
    return n > 0 ? `+${n}` : String(n);
}

/** The table `oracle:report --delta` prints. */
export function formatReadyDelta(
    rows: readonly ReadyDeltaRow[],
    baseline: string
): string {
    const lines = [
        `ready delta against ${baseline}`,
        `${"scope".padEnd(10)}${"before".padStart(8)}${"after".padStart(8)}${"delta".padStart(8)}${"lost".padStart(6)}`,
        "-".repeat(40),
    ];
    for (const r of rows) {
        lines.push(
            `${r.scope.padEnd(10)}${String(r.before).padStart(8)}${String(r.after).padStart(8)}` +
                `${signed(r.after - r.before).padStart(8)}${String(r.lost.length).padStart(6)}`
        );
    }
    return `${lines.join("\n")}\n`;
}

/**
 * The Bot-verdict side of the delta (ADR 0158 § 2a, issue #6688), read with
 * the sweep's own classification (`classifyVerdict`) so the two can never
 * disagree: a session PLAYS its graduations — a frozen one leaves `ready`
 * for `quarantine` and is named here, never silently absent from `gained` —
 * and CARRIES drift verdicts, marked `botStale`, which the base replays
 * after the merge.
 */
export interface VerdictDelta {
    /** Rows this tree graduated against the baseline that carry a verdict. */
    readonly graduated: number;
    /** The graduations the Bot froze (`bot-unreachable`), sorted. */
    readonly frozen: readonly string[];
    /** Rows carrying a verdict played on another definition (`botStale`). */
    readonly carried: number;
}

export function verdictDelta(
    before: readonly CardRow[],
    after: readonly CardRow[]
): VerdictDelta {
    const baseline = new Map(before.map((r) => [r.oracleId, r] as const));
    let graduated = 0;
    let carried = 0;
    const frozen: string[] = [];
    for (const r of after) {
        if (r.botReach === undefined || r.definition === undefined) continue;
        if (r.botStale === true) {
            carried++;
            continue;
        }
        const known = classifyVerdict(baseline.get(r.oracleId), r.definition);
        if (known.kind !== "graduation") continue;
        graduated++;
        if (r.botReach === "frozen") frozen.push(r.name);
    }
    return { graduated, frozen: frozen.sort(), carried };
}

/** The lines `oracle:report --delta` prints under the table. */
export function formatVerdictDelta(delta: VerdictDelta): string {
    const frozen =
        delta.frozen.length > 0
            ? `, ${delta.frozen.length} frozen by the Bot: ${delta.frozen.join(", ")}`
            : "";
    return (
        `bot verdicts: ${delta.graduated} graduation(s) played here${frozen}\n` +
        `bot verdicts: ${delta.carried} drift row(s) carried stale — the base replays them after the merge\n`
    );
}
