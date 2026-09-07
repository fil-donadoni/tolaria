import { TableHead } from "@/components/ui/table";
import { DynamicTerm } from "../DynamicTerm";
import { labelFor } from "../../glossary";
import type { SortState } from "../../lib/dataSort";
import type { DataColumn } from "./DataColumn";

/**
 * One column header (PRD #3148 S3) — its glossary label, its tooltip, and its
 * sort affordance.
 *
 * A `<button>` inside the `<th>`, not a click handler on the cell: sorting a
 * table is an action, and before this port it was reachable with a pointer
 * only. `aria-sort` on the cell is what tells a screen reader which column the
 * order it is reading actually follows.
 *
 * The label is the glossary's, never the raw column name (#2633/#2634) —
 * `impl_min` reads "implement minutes". It is resolved through `DynamicTerm`
 * rather than `Term` because the keys are composed at runtime from the
 * dataset's own metric list, which this page reads from `/api/meta` and does
 * not declare.
 */
export function SortableHeader<Row>({
    column,
    sort,
    onSort,
}: {
    column: DataColumn<Row>;
    /** `null` on a pivot that has no interactive sort. */
    sort: SortState | null;
    onSort?: (key: string) => void;
}) {
    const term = column.term ?? column.key;
    const text = column.label ?? labelFor(term);
    const active = sort?.key === column.key;
    const ariaSort = !active
        ? undefined
        : sort.dir === -1
          ? "descending"
          : "ascending";

    if (column.fixed || !onSort) {
        return (
            <TableHead className="text-muted-foreground text-xs font-medium">
                <DynamicTerm term={term}>{text}</DynamicTerm>
            </TableHead>
        );
    }

    return (
        <TableHead
            aria-sort={ariaSort}
            className="text-muted-foreground p-0 text-xs font-medium"
        >
            <button
                type="button"
                data-key={column.key}
                onClick={() => onSort(column.key)}
                className="hover:text-foreground focus-visible:ring-ring inline-flex w-full items-center gap-1 px-2 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
                <DynamicTerm term={term}>{text}</DynamicTerm>
                <span aria-hidden="true" className="tabular-nums">
                    {active ? (sort.dir === -1 ? "↓" : "↑") : ""}
                </span>
            </button>
        </TableHead>
    );
}
