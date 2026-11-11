import { useMemo, useState } from "react";
import { useDraftableSets } from "~/hooks/useLimitedEvent";
import { useArchetypeCatalogue } from "~/hooks/useCardProfiles";
import { useScopeCardRatings } from "~/hooks/useCardRatings";
import type { SortState } from "~/lib/adminTableSort";
import AdminScopeRail from "../tool/admin-scope-rail";
import PickRatingsFilters, {
    type RatingFilterKey,
} from "./pick-ratings-filters";
import PickRatingsScopeRail from "./pick-ratings-scope-rail";
import PickRatingsTable from "./pick-ratings-table";
import {
    EMPTY_FILTERS,
    filterCards,
    sortCards,
    typeOptions,
    type RatingFilters,
    type RatingSortKey,
} from "./pick-ratings-model";

const DEFAULT_SORT: SortState<RatingSortKey> = {
    key: "card",
    direction: "asc",
};

/** The Pick Ratings desktop tool (PRD #8772, issue #8908): the Card Profiles
 *  page's collapsible scope rail and sortable table over the Bot Drafter's
 *  per-scope ratings. Mounted only by `PickRatingsAdminPanel` once the admin
 *  gate has passed. */
export default function PickRatingsPage() {
    const draftableSets = useDraftableSets();
    // Only a Draftable scope can show up in a bot pick, so only one is worth
    // rating.
    const scopes = (draftableSets ?? []).filter((s) => s.draftable);
    const [scope, setScope] = useState<string | undefined>(undefined);
    const [railOpen, setRailOpen] = useState(true);
    const [filters, setFilters] = useState<RatingFilters>(EMPTY_FILTERS);
    const [sort, setSort] = useState(DEFAULT_SORT);

    const resolvedScope = scope ?? scopes[0]?.setCode;
    const cards = useScopeCardRatings(resolvedScope);
    const archetypeCatalogue = useArchetypeCatalogue();

    const visible = useMemo(
        () =>
            cards ? sortCards(filterCards(cards, filters), sort) : undefined,
        [cards, filters, sort]
    );
    const types = useMemo(() => typeOptions(cards), [cards]);

    function changeScope(next: string) {
        setFilters(EMPTY_FILTERS);
        setSort(DEFAULT_SORT);
        setScope(next);
    }

    function toggleFilter(filter: RatingFilterKey, value: string) {
        setFilters((prev) => ({
            ...prev,
            [filter]: prev[filter].includes(value)
                ? prev[filter].filter((entry) => entry !== value)
                : [...prev[filter], value],
        }));
    }

    return (
        <div className="flex flex-col gap-4 min-[1500px]:flex-row">
            <AdminScopeRail
                open={railOpen}
                onToggle={() => setRailOpen((open) => !open)}
                label="Scope rail"
            >
                <PickRatingsScopeRail
                    scopes={scopes}
                    scope={resolvedScope}
                    onScopeChange={changeScope}
                    cards={cards}
                />
            </AdminScopeRail>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
                <p className="text-xs leading-snug text-text-muted">
                    The effective rating is the{" "}
                    <strong className="font-medium text-text">Override</strong>{" "}
                    if a human wrote one, else the{" "}
                    <strong className="font-medium text-text">Seed</strong>,
                    else the{" "}
                    <strong className="font-medium text-text">
                        Scope median
                    </strong>
                    .
                </p>
                <PickRatingsFilters
                    filters={filters}
                    onSearch={(search) =>
                        setFilters((prev) => ({ ...prev, search }))
                    }
                    onToggle={toggleFilter}
                    catalogue={archetypeCatalogue}
                    types={types}
                />
                {resolvedScope === undefined ? (
                    <p className="text-xs text-text-muted">
                        Select a scope to view its ratings.
                    </p>
                ) : visible === undefined ? (
                    <p className="text-xs text-text-muted">Loading…</p>
                ) : cards?.length === 0 ? (
                    <p className="text-xs text-text-muted">
                        No cards for this scope yet.
                    </p>
                ) : visible.length === 0 ? (
                    <p className="text-xs text-text-muted">
                        No cards match your filters.
                    </p>
                ) : (
                    <PickRatingsTable
                        cards={visible}
                        sort={sort}
                        onSort={setSort}
                    />
                )}
            </div>
        </div>
    );
}
