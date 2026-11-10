import { useMemo, useState } from "react";
import { CUBE_SOURCE_KEY } from "@convex/limited/cubeSource";
import { useDraftableSets } from "~/hooks/useLimitedEvent";
import {
    useArchetypeCatalogue,
    useCardProfileMutations,
    useScopeCardProfiles,
} from "~/hooks/useCardProfiles";
import SegmentedControl from "~/components/ui/segmented-control";
import type { SortState } from "~/lib/adminTableSort";
import AdminReviewProgress from "../tool/admin-review-progress";
import AdminScopeRail from "../tool/admin-scope-rail";
import CardProfilesFilters from "./card-profiles-filters";
import CardProfilesScopeRail from "./card-profiles-scope-rail";
import CardProfilesTable from "./card-profiles-table";
import {
    EMPTY_FILTERS,
    filterCards,
    reviewProgress,
    sortCards,
    TAB_COLUMNS,
    type ProfileFilters,
    type ProfileSortKey,
    type ProfileTab,
} from "./card-profiles-model";

const TAB_OPTIONS = [
    { value: "capabilities", label: "Capabilities" },
    { value: "archetypes", label: "Archetypes" },
] as const;

const DEFAULT_SORT: SortState<ProfileSortKey> = {
    key: "card",
    direction: "asc",
};

type FilterKey = "status" | "archetype" | "provides" | "requires";

/** The Card Profiles desktop tool (PRD #8772, issue #8903; prototype verdict
 *  D): a collapsible scope rail, two tabs and a table that takes the width.
 *
 *  **Capabilities** is the catalogue-wide layer — no scope: it lists the
 *  cube the Capability census covers (`CUBE_SOURCE_KEY`) and the rail stays
 *  out of the way. **Archetypes** is per scope: the rail picks the scope and
 *  its catalogue rows filter the table. Mounted only by
 *  `CardProfilesAdminPanel` once the admin gate has passed. */
export default function CardProfilesPage() {
    const draftableSets = useDraftableSets();
    // Only a Draftable scope can show up in a bot pick (same gate as the Pick
    // Rating editor), so only one is worth profiling.
    const scopes = (draftableSets ?? []).filter((s) => s.draftable);
    const [tab, setTab] = useState<ProfileTab>("archetypes");
    const [scope, setScope] = useState<string | undefined>(undefined);
    const [railOpen, setRailOpen] = useState(true);
    const [filters, setFilters] = useState<ProfileFilters>(EMPTY_FILTERS);
    const [sort, setSort] = useState(DEFAULT_SORT);
    const [openCardId, setOpenCardId] = useState<string | null>(null);

    const resolvedScope = scope ?? scopes[0]?.setCode;
    const activeScope =
        tab === "capabilities" ? CUBE_SOURCE_KEY : resolvedScope;
    const cards = useScopeCardProfiles(activeScope);
    const { setProfile, clearProfile } = useCardProfileMutations();
    const archetypeCatalogue = useArchetypeCatalogue();

    const visible = useMemo(
        () =>
            cards ? sortCards(filterCards(cards, filters), sort) : undefined,
        [cards, filters, sort]
    );
    const progress = reviewProgress(cards);

    function resetView() {
        setFilters(EMPTY_FILTERS);
        setSort(DEFAULT_SORT);
        setOpenCardId(null);
    }

    function changeTab(next: ProfileTab) {
        resetView();
        setTab(next);
    }

    function changeScope(next: string) {
        resetView();
        setScope(next);
    }

    function toggleFilter(filter: FilterKey, value: string) {
        setFilters((prev) => ({
            ...prev,
            [filter]: prev[filter].includes(value)
                ? prev[filter].filter((entry) => entry !== value)
                : [...prev[filter], value],
        }));
    }

    /** Open the row AFTER `cardId` in the CURRENT visible order, or close up
     *  when it was the last — read before the saved row leaves a filtered
     *  list. */
    function advanceFrom(cardId: string) {
        const list = visible ?? [];
        const index = list.findIndex((card) => card.cardId === cardId);
        const next = index === -1 ? undefined : list[index + 1];
        setOpenCardId(next ? next.cardId : null);
    }

    const sortable = TAB_COLUMNS[tab].includes(sort.key) ? sort : DEFAULT_SORT;

    return (
        <div className="flex flex-col gap-4 min-[1500px]:flex-row">
            {tab === "archetypes" && (
                <AdminScopeRail
                    open={railOpen}
                    onToggle={() => setRailOpen((open) => !open)}
                    label="Scope rail"
                >
                    <CardProfilesScopeRail
                        scopes={scopes}
                        scope={resolvedScope}
                        onScopeChange={changeScope}
                        cards={cards}
                        catalogue={archetypeCatalogue}
                        selectedArchetypes={filters.archetype}
                        onToggleArchetype={(id) =>
                            toggleFilter("archetype", id)
                        }
                    />
                </AdminScopeRail>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
                <SegmentedControl
                    options={TAB_OPTIONS}
                    value={tab}
                    onChange={changeTab}
                    ariaLabel="Profile layer"
                />
                {tab === "capabilities" && (
                    <AdminReviewProgress
                        label="Human review pass"
                        done={progress.reviewed}
                        total={progress.profiled}
                        emptyText="No profiled cards yet"
                    />
                )}
                <p className="text-xs leading-snug text-text-muted">
                    <strong className="font-medium text-text">Provides</strong>{" "}
                    is what a card OFFERS a partner;{" "}
                    <strong className="font-medium text-text">Requires</strong>{" "}
                    is what it NEEDS from one.{" "}
                    <strong className="font-medium text-text">
                        An empty Requires is the norm
                    </strong>{" "}
                    — only reanimation spells, cheat-into-play effects,
                    storm/metalcraft payoffs and graveyard-scaling costs require
                    anything.
                </p>
                <CardProfilesFilters
                    tab={tab}
                    filters={filters}
                    onSearch={(search) =>
                        setFilters((prev) => ({ ...prev, search }))
                    }
                    onToggle={toggleFilter}
                    catalogue={archetypeCatalogue}
                />
                {activeScope === undefined ? (
                    <p className="text-xs text-text-muted">
                        Select a scope to view/edit its Card Profiles.
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
                    <CardProfilesTable
                        tab={tab}
                        cards={visible}
                        sort={sortable}
                        onSort={setSort}
                        openCardId={openCardId}
                        onToggleRow={(cardId) =>
                            setOpenCardId((prev) =>
                                prev === cardId ? null : cardId
                            )
                        }
                        onSave={(cardId, profile) =>
                            setProfile({
                                scope: activeScope,
                                cardId,
                                ...profile,
                            })
                        }
                        onClear={(cardId) =>
                            clearProfile({ scope: activeScope, cardId })
                        }
                        onAdvance={advanceFrom}
                        archetypeCatalogue={archetypeCatalogue}
                    />
                )}
            </div>
        </div>
    );
}
