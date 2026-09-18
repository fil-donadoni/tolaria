/**
 * Card name → Oracle Lockfile row: the ONE name resolver every Target List
 * reads through (issue #3867) — the Tier 1 lists, the metagame import, the
 * Vintage Cube and whatever list is registered next.
 *
 * Fail-closed by construction: a name this index cannot map to exactly one
 * row maps to nothing, and every caller throws on nothing. Picking one row of
 * several would let a list report the state of a different card.
 *
 * Reads the LOCKFILE, never the corpus: the lockfile carries one row per
 * corpus card, so the two answer the same question, and only the lockfile is
 * committed.
 */

import type { CardRow, Lockfile } from "./oracle-lockfile";

/** The separator of a multi-faced card's combined name. */
const FACE_SEPARATOR = " // ";

/**
 * Name → lockfile row, with the ambiguous names REMOVED rather than resolved.
 *
 * Two kinds of key:
 *
 * - the row's own `name` — 76 corpus names are carried by more than one
 *   oracle id (Un-set variants of "Ineffable Blessing" and friends), and those
 *   resolve to nothing;
 * - the FRONT FACE of a multi-faced name (`Ajani, Nacatl Pariah` for
 *   `Ajani, Nacatl Pariah // Ajani, Nacatl Avenger`), because a name list
 *   written by a human names the card by what is printed on its front. An
 *   alias never shadows a real name — ambiguous ones included — and a front
 *   face two multi-faced cards share resolves to nothing.
 */
export function corpusNameIndex(
    lock: Pick<Lockfile, "cards">
): ReadonlyMap<string, CardRow> {
    const byName = new Map<string, CardRow>();
    const ambiguous = new Set<string>();
    for (const row of lock.cards) {
        if (byName.has(row.name)) ambiguous.add(row.name);
        else byName.set(row.name, row);
    }
    const exactNames = new Set(byName.keys());
    for (const name of ambiguous) byName.delete(name);

    const byFront = new Map<string, CardRow>();
    const ambiguousFront = new Set<string>();
    for (const row of lock.cards) {
        const at = row.name.indexOf(FACE_SEPARATOR);
        if (at === -1) continue;
        const front = row.name.slice(0, at);
        if (exactNames.has(front)) continue;
        const seen = byFront.get(front);
        if (seen !== undefined && seen.oracleId !== row.oracleId)
            ambiguousFront.add(front);
        else byFront.set(front, row);
    }
    for (const [front, row] of byFront) {
        if (!ambiguousFront.has(front)) byName.set(front, row);
    }
    return byName;
}
