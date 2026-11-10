import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "~/components/ui/table";
import type { SortDirection } from "~/lib/adminTableSort";

interface AdminSortableHeadProps {
    label: string;
    /** `null` while another column is the sorted one. */
    direction: SortDirection | null;
    onSort: () => void;
}

/** One sortable column header of an admin tool table: a button inside the
 *  `<th>`, the sorted state exposed as `aria-sort`. */
export default function AdminSortableHead({
    label,
    direction,
    onSort,
}: AdminSortableHeadProps) {
    const Icon =
        direction === null
            ? ArrowUpDown
            : direction === "asc"
              ? ArrowUp
              : ArrowDown;
    return (
        <TableHead
            aria-sort={
                direction === null
                    ? "none"
                    : direction === "asc"
                      ? "ascending"
                      : "descending"
            }
        >
            <button
                type="button"
                onClick={onSort}
                className="text-label flex items-center gap-1 hover:text-parchment"
            >
                {label}
                <Icon className="size-3" aria-hidden="true" />
            </button>
        </TableHead>
    );
}
