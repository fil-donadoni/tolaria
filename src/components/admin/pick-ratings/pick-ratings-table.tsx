import {
    Table,
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import { nextSort, type SortState } from "~/lib/adminTableSort";
import AdminSortableHead from "../tool/admin-sortable-head";
import PickRatingsRow from "./pick-ratings-row";
import {
    COLUMN_LABEL,
    RATING_COLUMNS,
    type RatingSortKey,
} from "./pick-ratings-model";

interface PickRatingsTableProps {
    /** The rows to show — already filtered and sorted; this table only draws. */
    cards: ScopeCardRating[];
    sort: SortState<RatingSortKey>;
    onSort: (sort: SortState<RatingSortKey>) => void;
    /** The card open in the rating dialog, highlighted here. */
    openCardId: string | null;
    onOpen: (cardId: string) => void;
}

/** The sortable table: every column header sorts (`aria-sort`). */
export default function PickRatingsTable({
    cards,
    sort,
    onSort,
    openCardId,
    onOpen,
}: PickRatingsTableProps) {
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    {RATING_COLUMNS.map((key) => (
                        <AdminSortableHead
                            key={key}
                            label={COLUMN_LABEL[key]}
                            direction={sort.key === key ? sort.direction : null}
                            onSort={() => onSort(nextSort(sort, key))}
                        />
                    ))}
                    <TableHead>
                        <span className="sr-only">Actions</span>
                    </TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {cards.map((card) => (
                    <PickRatingsRow
                        key={card.cardId}
                        card={card}
                        columns={RATING_COLUMNS}
                        open={card.cardId === openCardId}
                        onOpen={() => onOpen(card.cardId)}
                    />
                ))}
            </TableBody>
        </Table>
    );
}
