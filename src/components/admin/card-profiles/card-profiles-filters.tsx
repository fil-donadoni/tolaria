import type { ArchetypeCatalogueRow } from "@convex/limited/archetypeCatalogueCore";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import MultiCombobox from "~/components/lobby/deck-builder/multi-combobox";
import { Input } from "~/components/ui/input";
import {
    STATUS_LABEL,
    type ProfileFilters,
    type ProfileStatus,
    type ProfileTab,
} from "./card-profiles-model";

type FilterKey = "status" | "archetype" | "provides" | "requires";

interface CardProfilesFiltersProps {
    tab: ProfileTab;
    filters: ProfileFilters;
    onSearch: (search: string) => void;
    onToggle: (filter: FilterKey, value: string) => void;
    catalogue: readonly ArchetypeCatalogueRow[];
}

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as ProfileStatus[]).map(
    (value) => ({ value, label: STATUS_LABEL[value] })
);

const CAPABILITY_OPTIONS = CAPABILITY_REGISTRY.map((row) => ({
    value: row.id,
    label: row.id,
}));

/** Search plus the tab's MultiCombobox filters — OR within one, AND across
 *  (`filterCards`). Status on both tabs; Archetype on the Archetypes tab;
 *  Provides and Requires on the Capabilities tab. */
export default function CardProfilesFilters({
    tab,
    filters,
    onSearch,
    onToggle,
    catalogue,
}: CardProfilesFiltersProps) {
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
                options={STATUS_OPTIONS}
                selected={filters.status}
                onToggle={(value) => onToggle("status", value)}
                placeholder="Status"
                searchPlaceholder="Search statuses…"
                emptyText="No such status."
                labelClassName=""
            />
            {tab === "archetypes" && (
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
            )}
            {tab === "capabilities" && (
                <>
                    <MultiCombobox
                        options={CAPABILITY_OPTIONS}
                        selected={filters.provides}
                        onToggle={(value) => onToggle("provides", value)}
                        placeholder="Provides"
                        searchPlaceholder="Search capabilities…"
                        emptyText="No such capability."
                        labelClassName=""
                    />
                    <MultiCombobox
                        options={CAPABILITY_OPTIONS}
                        selected={filters.requires}
                        onToggle={(value) => onToggle("requires", value)}
                        placeholder="Requires"
                        searchPlaceholder="Search capabilities…"
                        emptyText="No such capability."
                        labelClassName=""
                    />
                </>
            )}
        </div>
    );
}
