import {
    Table,
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import type {
    EditableCardProfile,
    ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import type { ArchetypeCatalogueRow } from "@convex/limited/archetypeCatalogueCore";
import { nextSort, type SortState } from "~/lib/adminTableSort";
import AdminSortableHead from "../tool/admin-sortable-head";
import CardProfilesRow from "./card-profiles-row";
import {
    COLUMN_LABEL,
    TAB_COLUMNS,
    type ProfileSortKey,
    type ProfileTab,
} from "./card-profiles-model";

interface CardProfilesTableProps {
    tab: ProfileTab;
    /** The rows to show — already filtered and sorted; this table only draws. */
    cards: ScopeCardProfile[];
    sort: SortState<ProfileSortKey>;
    onSort: (sort: SortState<ProfileSortKey>) => void;
    openCardId: string | null;
    onToggleRow: (cardId: string) => void;
    onSave: (cardId: string, profile: EditableCardProfile) => Promise<unknown>;
    onClear: (cardId: string) => Promise<unknown>;
    onAdvance: (cardId: string) => void;
    archetypeCatalogue: readonly ArchetypeCatalogueRow[];
}

/** The tab's sortable table: every column header sorts (`aria-sort`), the
 *  last column holds the row's Edit button. */
export default function CardProfilesTable({
    tab,
    cards,
    sort,
    onSort,
    openCardId,
    onToggleRow,
    onSave,
    onClear,
    onAdvance,
    archetypeCatalogue,
}: CardProfilesTableProps) {
    const columns = TAB_COLUMNS[tab];
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    {columns.map((key) => (
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
                    <CardProfilesRow
                        key={card.cardId}
                        card={card}
                        columns={columns}
                        open={openCardId === card.cardId}
                        onToggle={() => onToggleRow(card.cardId)}
                        onSave={(profile) => onSave(card.cardId, profile)}
                        onClear={() => onClear(card.cardId)}
                        onAdvance={() => onAdvance(card.cardId)}
                        archetypeCatalogue={archetypeCatalogue}
                    />
                ))}
            </TableBody>
        </Table>
    );
}
