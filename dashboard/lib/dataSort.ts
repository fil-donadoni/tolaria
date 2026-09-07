import type { DataColumn } from "../components/history/DataColumn";

/** Which column a table is sorted by, and in which direction. `-1` is
 *  descending — the convention every History table already used. */
export interface SortState {
    key: string;
    dir: -1 | 1;
}

/**
 * The next sort state after a header click (PRD #3148 S3): clicking the column
 * already sorted flips the direction, clicking any other starts it descending.
 *
 * Descending-first is not arbitrary. Every sortable column on this page is a
 * cost, a duration, a count or a date, and the question a person opens the
 * table with is "which is the biggest / most recent", never "which is the
 * smallest".
 */
export const nextSort = (current: SortState, key: string): SortState =>
    current.key === key
        ? { key, dir: (current.dir === -1 ? 1 : -1) as -1 | 1 }
        : { key, dir: -1 };

/**
 * Sort rows by a column, the one comparison rule all four History tables use.
 *
 * Numeric columns compare as numbers with a missing value read as `0`; every
 * other column compares with `localeCompare` on the string form. The value
 * compared is the RAW field (or the column's own `sortValue`), never the
 * rendered cell — a cost column sorted by "$1,024" against "$98" is sorted
 * alphabetically, which is the defect #2634 recorded.
 *
 * Returns a new array; the caller's rows are never reordered in place.
 */
export function sortRows<Row>(
    rows: readonly Row[],
    columns: readonly DataColumn<Row>[],
    sort: SortState
): Row[] {
    const col = columns.find((c) => c.key === sort.key);
    const read = (row: Row): string | number | null | undefined =>
        col?.sortValue
            ? col.sortValue(row)
            : (row as Record<string, string | number | null | undefined>)[
                  sort.key
              ];
    return [...rows].sort((a, b) => {
        const av = read(a);
        const bv = read(b);
        const cmp = col?.num
            ? (Number(av) || 0) - (Number(bv) || 0)
            : String(av ?? "").localeCompare(String(bv ?? ""));
        return cmp * sort.dir;
    });
}
