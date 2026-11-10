// Column sorting + multi-select filtering shared by the admin tool pages
// (Card Profiles, and the Pick Ratings page that reuses them — PRD #8772).
// Pure, so the sort order and the filter algebra are unit-testable without a
// table.

export type SortDirection = "asc" | "desc";

export interface SortState<Key extends string> {
    key: Key;
    direction: SortDirection;
}

/** A header click: the active column flips direction, any other column
 *  starts ascending. */
export function nextSort<Key extends string>(
    current: SortState<Key>,
    key: Key
): SortState<Key> {
    if (current.key !== key) return { key, direction: "asc" };
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** A sorted copy. `valueOf` yields the column's comparable (a number sorts
 *  numerically, a string by locale); ties keep their input order. */
export function sortRows<Row, Key extends string>(
    rows: readonly Row[],
    sort: SortState<Key>,
    valueOf: (row: Row, key: Key) => string | number
): Row[] {
    const sign = sort.direction === "asc" ? 1 : -1;
    return rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => {
            const left = valueOf(a.row, sort.key);
            const right = valueOf(b.row, sort.key);
            const order =
                typeof left === "number" && typeof right === "number"
                    ? left - right
                    : String(left).localeCompare(String(right));
            return order === 0 ? a.index - b.index : order * sign;
        })
        .map(({ row }) => row);
}

/** One filter's selection against the values a row carries: an empty
 *  selection admits every row; otherwise the row must carry AT LEAST ONE
 *  selected value (OR within a filter). Callers AND the filters together. */
export function matchesAny(
    selected: readonly string[],
    rowValues: readonly string[]
): boolean {
    return (
        selected.length === 0 ||
        selected.some((value) => rowValues.includes(value))
    );
}
