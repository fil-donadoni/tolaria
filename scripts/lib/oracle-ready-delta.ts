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
