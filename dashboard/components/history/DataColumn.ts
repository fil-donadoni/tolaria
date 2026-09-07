import type { ReactNode } from "react";

/**
 * One column of a `DataTable` (PRD #3148 S3).
 *
 * A TYPE, in its own file, because all four History tables declare their
 * columns against it and a shared shape that lives inside one of them is a
 * shape the other three import from a component.
 *
 * `key` is the SORT IDENTITY and stays the raw field name — sort state is
 * keyed on it, never on the rendered label, so relabelling a header cannot
 * silently break its sort (#2634's stated hazard). `term` is the GLOSSARY key,
 * which diverges from `key` in exactly one place today (Sessions' `title`
 * renders `history.session-title`, because the bare `session` entry says the
 * id is "deliberately absent from the filter pickers" and this table does
 * offer a search box over it).
 */
export interface DataColumn<Row> {
    /** The raw field name — the sort identity, never the rendered text. */
    key: string;
    /** The glossary key, when it differs from `key`. */
    term?: string;
    /** Overrides the glossary label — for a header the glossary cannot name
     *  because it is composed at runtime (a metric column, a split). */
    label?: string;
    /** Compare as numbers rather than with `localeCompare`. */
    num?: boolean;
    /** The value sorting compares, when it is not `row[key]` — Sessions sorts
     *  its `prs` column by the LENGTH of the JSON array it renders a count
     *  of, which is not a field on the row at all. */
    sortValue?: (row: Row) => string | number | null | undefined;
    /** What the cell renders. */
    cell: (row: Row) => ReactNode;
    /** Suppress the header's sort affordance — the Family × role pivot is
     *  fixed, descending by total, and has no sortable column. */
    fixed?: boolean;
}
