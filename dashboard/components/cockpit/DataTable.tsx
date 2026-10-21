import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { EmptyNote } from "../EmptyNote";

export interface Column<R> {
    header: ReactNode;
    cell: (row: R) => ReactNode;
    /** Right-aligned, tabular figures. */
    numeric?: boolean;
}

/** The cockpit's one table: a header row, a row per item, or the sentence
 *  saying there is none. */
export function DataTable<R>({
    columns,
    rows,
    rowKey,
    empty,
    label,
}: {
    columns: readonly Column<R>[];
    rows: readonly R[];
    rowKey: (row: R) => string;
    empty: string;
    /** The table's accessible name. */
    label: string;
}) {
    if (rows.length === 0) return <EmptyNote>{empty}</EmptyNote>;
    return (
        <Table aria-label={label} className="text-xs">
            <TableHeader>
                <TableRow>
                    {columns.map((c, i) => (
                        <TableHead
                            key={i}
                            className={cn(
                                "h-8 text-xs",
                                c.numeric && "text-right"
                            )}
                        >
                            {c.header}
                        </TableHead>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((r) => (
                    <TableRow key={rowKey(r)}>
                        {columns.map((c, i) => (
                            <TableCell
                                key={i}
                                className={cn(
                                    "py-1.5",
                                    c.numeric && "text-right tabular-nums"
                                )}
                            >
                                {c.cell(r)}
                            </TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
