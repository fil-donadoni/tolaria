import type { ArchetypeCatalogueRow } from "@convex/limited/archetypeCatalogueCore";
import MultiCombobox from "~/components/lobby/deck-builder/multi-combobox";
import { Input } from "~/components/ui/input";
import {
    RARITY_LABEL,
    SOURCE_LABEL,
    type RatingFilters,
} from "./pick-ratings-model";

export type RatingFilterKey = "source" | "rarity" | "type" | "archetype";

interface PickRatingsFiltersProps {
    filters: RatingFilters;
    onSearch: (search: string) => void;
    onToggle: (filter: RatingFilterKey, value: string) => void;
    catalogue: readonly ArchetypeCatalogueRow[];
    /** The card types present in the scope. */
    types: readonly string[];
}

const SOURCE_OPTIONS = Object.entries(SOURCE_LABEL).map(([value, label]) => ({
    value,
    label,
}));

const RARITY_OPTIONS = Object.entries(RARITY_LABEL).map(([value, label]) => ({
    value,
    label,
}));

/** Search plus the Source, Rarity, Type and Archetype MultiCombobox filters —
 *  OR within one, AND across (`filterCards`). */
export default function PickRatingsFilters({
    filters,
    onSearch,
    onToggle,
    catalogue,
    types,
}: PickRatingsFiltersProps) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Input
                type="text"
                placeholder="Search cards…"
                aria-label="Search cards"
                value={filters.search}
                onChange={(e) => onSearch(e.currentTarget.value)}
                className="max-w-64"
            />
            <MultiCombobox
                options={SOURCE_OPTIONS}
                selected={filters.source}
                onToggle={(value) => onToggle("source", value)}
                placeholder="Source"
                searchPlaceholder="Search sources…"
                emptyText="No such source."
                labelClassName=""
            />
            <MultiCombobox
                options={RARITY_OPTIONS}
                selected={filters.rarity}
                onToggle={(value) => onToggle("rarity", value)}
                placeholder="Rarity"
                searchPlaceholder="Search rarities…"
                emptyText="No such rarity."
                labelClassName=""
            />
            <MultiCombobox
                options={types.map((value) => ({ value, label: value }))}
                selected={filters.type}
                onToggle={(value) => onToggle("type", value)}
                placeholder="Type"
                searchPlaceholder="Search types…"
                emptyText="No such type."
                labelClassName=""
            />
            <MultiCombobox
                options={catalogue.map((row) => ({
                    value: row.id,
                    label: row.id,
                }))}
                selected={filters.archetype}
                onToggle={(value) => onToggle("archetype", value)}
                placeholder="Archetype"
                searchPlaceholder="Search archetypes…"
                emptyText="No such archetype."
                labelClassName=""
            />
        </div>
    );
}
