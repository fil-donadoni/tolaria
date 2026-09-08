import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { TableHead } from "@/components/ui/table";
import { DynamicTerm } from "../DynamicTerm";
import { labelFor, lookupTerm } from "../../glossary";
import type { SortState } from "../../lib/dataSort";
import type { DataColumn } from "./DataColumn";

/**
 * One column header (PRD #3148 S3) — its glossary label, its tooltip, and its
 * sort affordance.
 *
 * ── ONE TAB STOP, AND IT IS THE CONTROL ───────────────────────────────────
 *
 * A sortable header is a `<button>`, because sorting a table is an action and
 * before this port it was reachable with a pointer only. That makes the
 * BUTTON the tooltip's trigger rather than a `<DynamicTerm>` inside it:
 * interactive content is not permitted inside a `<button>` (the rule
 * `LightButton` states for the same reason), and a focusable span in there
 * would be a second tab stop that opens the explanation while the first one
 * silently does not. base-ui opens on focus as well as hover, so one control
 * carries both jobs.
 *
 * A FIXED header has no control, so it uses `<DynamicTerm>` like every other
 * surface.
 *
 * `aria-sort` on the cell is what tells a screen reader which column the order
 * it is reading actually follows — an arrow glyph says it to nobody else.
 *
 * The label is the glossary's, never the raw column name (#2633/#2634) —
 * `impl_min` reads "implement minutes". It is resolved at RUNTIME because the
 * keys are composed from the dataset's own metric list, which this page reads
 * from `/api/meta` and does not declare.
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
    const entry = lookupTerm(term);
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

    const button = (
        <button
            type="button"
            data-key={column.key}
            onClick={() => onSort(column.key)}
            className="hover:text-foreground focus-visible:ring-ring inline-flex w-full items-center gap-1 px-2 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
            {text}
            <span aria-hidden="true" className="tabular-nums">
                {active ? (sort.dir === -1 ? "↓" : "↑") : ""}
            </span>
        </button>
    );

    return (
        <TableHead
            aria-sort={ariaSort}
            className="text-muted-foreground p-0 text-xs font-medium"
        >
            {entry ? (
                <Tooltip>
                    <TooltipTrigger render={button} />
                    <TooltipContent className="max-w-xs text-left">
                        {entry.tip}
                    </TooltipContent>
                </Tooltip>
            ) : (
                button
            )}
        </TableHead>
    );
}
