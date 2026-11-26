// The generated vector's SPARSE form (ADR 0186, Decision 1; issue #10853).
//
// The column list is thousands wide and a position touches a few dozen of
// them, so a vector is the list of its non-zero columns: two parallel arrays,
// column indexes strictly ascending and the count at each. Ascending order is
// what makes the form canonical — one position, one seat, one pair of arrays —
// so two vectors are equal exactly when their arrays are, a difference is a
// merge, and a dot product with a dense weight table is one pass.
//
// Plain arrays, not typed ones: a vector is JSON as it stands, and a test's
// `toEqual` reads it. The indexes are handles into `generatedColumns()` of the
// SAME build (`columns.ts`); to keep a vector, keep `namedEntries`.

import { generatedColumnIndex, generatedColumns } from "./columns";

export type GeneratedVector = {
    /** Indexes into `generatedColumns()`, strictly ascending. */
    readonly columns: readonly number[];
    /** The count of each column above, same length; never zero. */
    readonly counts: readonly number[];
};

/** The sparse vector of an accumulator keyed by column index. */
export function vectorOf(counts: ReadonlyMap<number, number>): GeneratedVector {
    const columns: number[] = [];
    counts.forEach((count, column) => {
        if (count !== 0) columns.push(column);
    });
    columns.sort((a, b) => a - b);
    const out: number[] = new Array(columns.length);
    for (let i = 0; i < columns.length; i++) {
        out[i] = counts.get(columns[i]) as number;
    }
    return { columns, counts: out };
}

/** The vector as `[column name, count]` rows, in column order — the form to
 *  print, diff or store. */
export function namedEntries(vector: GeneratedVector): [string, number][] {
    const names = generatedColumns();
    const out: [string, number][] = new Array(vector.columns.length);
    for (let i = 0; i < vector.columns.length; i++) {
        out[i] = [names[vector.columns[i]], vector.counts[i]];
    }
    return out;
}

/** The count of the column named `name`: zero when the vector does not touch
 *  it. Throws on a name that is no column, so a typo cannot read as "zero". */
export function countOf(vector: GeneratedVector, name: string): number {
    const column = generatedColumnIndex(name);
    if (column === undefined) {
        throw new Error(`generated vector: no column named "${name}"`);
    }
    let lo = 0;
    let hi = vector.columns.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const at = vector.columns[mid];
        if (at === column) return vector.counts[mid];
        if (at < column) lo = mid + 1;
        else hi = mid - 1;
    }
    return 0;
}

/** `a − b`, column by column — the `x(right) − x(other)` of an Eval Pair
 *  (ADR 0124 §3), over the generated columns. Empty when the two are equal. */
export function subtractVectors(
    a: GeneratedVector,
    b: GeneratedVector
): GeneratedVector {
    const columns: number[] = [];
    const counts: number[] = [];
    let i = 0;
    let j = 0;
    while (i < a.columns.length || j < b.columns.length) {
        const ca = i < a.columns.length ? a.columns[i] : Infinity;
        const cb = j < b.columns.length ? b.columns[j] : Infinity;
        let column: number;
        let count: number;
        if (ca === cb) {
            column = ca;
            count = a.counts[i++] - b.counts[j++];
        } else if (ca < cb) {
            column = ca;
            count = a.counts[i++];
        } else {
            column = cb;
            count = -b.counts[j++];
        }
        if (count !== 0) {
            columns.push(column);
            counts.push(count);
        }
    }
    return { columns, counts };
}
