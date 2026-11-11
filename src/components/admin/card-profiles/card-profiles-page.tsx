import { useMemo, useState } from "react";
import { CUBE_SOURCE_KEY } from "@convex/limited/cubeSource";
import { useDraftableSets } from "~/hooks/useLimitedEvent";
import {
    useArchetypeCatalogue,
    useCardProfileMutations,
    useScopeCardProfiles,
    type EditableCardProfile,
} from "~/hooks/useCardProfiles";
import SegmentedControl from "~/components/ui/segmented-control";
import type { SortState } from "~/lib/adminTableSort";
import AdminReviewProgress from "../tool/admin-review-progress";
import AdminScopeRail from "../tool/admin-scope-rail";
import CardProfilesCapabilityRail from "./card-profiles-capability-rail";
import CardProfilesExportButton from "./card-profiles-export-button";
import CardProfilesFilters from "./card-profiles-filters";
import CardProfilesScopeRail from "./card-profiles-scope-rail";
import CardProfilesSweepBoard from "./card-profiles-sweep-board";
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
import type { SweepRow } from "./card-profiles-sweep-model";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";

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
 *  its catalogue rows filter the table. Either tab's rail opens the sweep
 *  board on one catalogue row (issue #8905) in the table's place — the
 *  Capabilities tab's rail carries no scope, only the Capability rows.
 *  Either rail's Export downloads its layer in seed-file format (issue
 *  #8907). Mounted only by `CardProfilesAdminPanel` once the admin gate has
 *  passed. */
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
    const [sweep, setSweep] = useState<SweepRow | null>(null);

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
        setSweep(null);
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

    function saveProfile(cardId: string, profile: EditableCardProfile) {
        if (activeScope === undefined) return Promise.resolve(null);
        return setProfile({ scope: activeScope, cardId, ...profile });
    }

    const sweepDescription =
        sweep === null
            ? undefined
            : sweep.kind === "archetype"
              ? archetypeCatalogue.find((row) => row.id === sweep.id)
                    ?.description
              : CAPABILITY_REGISTRY.find((row) => row.id === sweep.id)
                    ?.description;

    const sortable = TAB_COLUMNS[tab].includes(sort.key) ? sort : DEFAULT_SORT;

    return (
        <div className="flex flex-col gap-4 min-[1500px]:flex-row">
            {tab === "capabilities" && (
                <AdminScopeRail
                    open={railOpen}
                    onToggle={() => setRailOpen((open) => !open)}
                    label="Catalogue rail"
                >
                    <CardProfilesExportButton
                        layer="capabilities"
                        scope={undefined}
                    />
                    <CardProfilesCapabilityRail
                        cards={cards}
                        onSweep={(kind, id) => setSweep({ kind, id })}
                    />
                </AdminScopeRail>
            )}
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
                        onSweep={(id) => setSweep({ kind: "archetype", id })}
                    />
                    <CardProfilesExportButton
                        layer="archetypes"
                        scope={resolvedScope}
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
                {sweep !== null && cards !== undefined ? (
                    <CardProfilesSweepBoard
                        row={sweep}
                        description={sweepDescription}
                        cards={cards}
                        onSave={saveProfile}
                        onClose={() => setSweep(null)}
                    />
                ) : (
                    <>
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
                    </>
                )}
            </div>
        </div>
    );
}
