import { Fragment, type ReactNode } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { SortState } from "../../lib/dataSort";
import { sortRows } from "../../lib/dataSort";
import type { DataColumn } from "./DataColumn";
import { SortableHeader } from "./SortableHeader";

/**
 * The History view's ONE table (PRD #3148 S3).
 *
 * Four tables ship on this page — Issues, Sessions, Family × role, and the
 * metric Table card — and before the port each hand-rolled the same four
 * things: the sort comparison, the header arrow, the ellipsis-with-`title`
 * treatment and the empty state. `tableHtml(columns, rows)` built all of it by
 * string concatenation, so every cell was a fragment of HTML the caller had to
 * remember to escape (PRD #3148, "Why"). One escaping mistake is a rendering
 * bug at best; here the cells carry issue titles and shell command lines.
 *
 * What each table still owns is its COLUMNS and its filters. What it no longer
 * owns is how a table behaves.
 *
 * ── THE EMPTY STATE IS A SENTENCE ─────────────────────────────────────────
 *
 * `emptyMessage` is required, not optional (#2634): a blank box says nothing
 * about whether there is no data or whether a filter hid it, and only one of
 * those means "loosen a filter". The header row stays up in both cases, so the
 * table still says what it WOULD show.
 *
 * ── EXPANSION ─────────────────────────────────────────────────────────────
 *
 * Issues and Sessions expand a row into its subagent runs. The expanded panel
 * is a SIBLING row spanning every column, which is what keeps the drill-down
 * inside the table's own scroll container and column widths. `aria-expanded`
 * on the row is what makes the affordance audible; the shadcn primitive
 * already styles `has-aria-expanded`.
 */
export function DataTable<Row>({
    columns,
    rows,
    rowKey,
    sort,
    onSort,
    emptyMessage,
    expandedKey,
    onToggleRow,
    renderExpanded,
    caption,
}: {
    columns: readonly DataColumn<Row>[];
    rows: readonly Row[];
    rowKey: (row: Row) => string;
    /** `null` on a table whose order is fixed (the Family × role pivot). */
    sort: SortState | null;
    onSort?: (key: string) => void;
    emptyMessage: string;
    expandedKey?: string | null;
    onToggleRow?: (row: Row) => void;
    renderExpanded?: (row: Row) => ReactNode;
    /** The accessible name — a table with four siblings on one page needs to
     *  say which one it is. */
    caption: string;
}) {
    const ordered = sort ? sortRows(rows, columns, sort) : rows;

    return (
        <Table aria-label={caption}>
            <TableHeader>
                <TableRow>
                    {columns.map((column) => (
                        <SortableHeader
                            key={column.key}
                            column={column}
                            sort={sort}
                            onSort={onSort}
                        />
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {ordered.length === 0 ? (
                    <TableRow>
                        <TableCell
                            colSpan={columns.length}
                            className="text-muted-foreground py-6 text-center text-xs whitespace-normal"
                        >
                            {emptyMessage}
                        </TableCell>
                    </TableRow>
                ) : (
                    ordered.map((row) => {
                        const key = rowKey(row);
                        const expanded = expandedKey === key;
                        return (
                            <Fragment key={key}>
                                <TableRow
                                    data-row={key}
                                    aria-expanded={
                                        onToggleRow ? expanded : undefined
                                    }
                                    className={
                                        onToggleRow ? "cursor-pointer" : ""
                                    }
                                    onClick={
                                        onToggleRow
                                            ? (e) => {
                                                  // The issue cell's `#N` is a
                                                  // real link that opens its
                                                  // own tab (#2635 AC); a
                                                  // click on it must not ALSO
                                                  // toggle the drill-down,
                                                  // which is what a plain
                                                  // row-level listener does
                                                  // since the click bubbles up
                                                  // from the anchor.
                                                  if (
                                                      (
                                                          e.target as HTMLElement
                                                      ).closest("a")
                                                  )
                                                      return;
                                                  onToggleRow(row);
                                              }
                                            : undefined
                                    }
                                >
                                    {columns.map((column) => (
                                        <TableCell
                                            key={column.key}
                                            className="text-xs tabular-nums"
                                        >
                                            {column.cell(row)}
                                        </TableCell>
                                    ))}
                                </TableRow>
                                {expanded && renderExpanded ? (
                                    <TableRow data-drill={key}>
                                        <TableCell
                                            colSpan={columns.length}
                                            className="bg-muted/40 p-0"
                                        >
                                            {renderExpanded(row)}
                                        </TableCell>
                                    </TableRow>
                                ) : null}
                            </Fragment>
                        );
                    })
                )}
            </TableBody>
        </Table>
    );
}
