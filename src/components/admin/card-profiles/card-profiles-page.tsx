import { useMemo, useState } from "react";
import { CUBE_SOURCE_KEY } from "@convex/limited/cubeSource";
import { useDraftableSets } from "~/hooks/useLimitedEvent";
import {
    useArchetypeCatalogue,
    useArchetypeCatalogueMutations,
    useCardProfileMutations,
    useScopeCardProfiles,
    type EditableCardProfile,
    type ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import { CENSUS_RESIDUE_FILES, residueForScope } from "~/lib/censusResidue";
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
import CardProfileFocusDialog from "./card-profile-focus-dialog";
import {
    effectiveProfile,
    EMPTY_FILTERS,
    filterCards,
    reviewProgress,
    sortCards,
    TAB_COLUMNS,
    type LayerSave,
    type ProfileFilters,
    type ProfileSortKey,
    type ProfileTab,
} from "./card-profiles-model";
import type { SweepRow } from "./card-profiles-sweep-model";
import { sweepTab } from "./card-profiles-sweep-model";
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

/** The focus dialog's walk: the table's order FROZEN when a row opens. The
 *  dialog is modal, so the filters and the sort cannot change under it —
 *  but a save can move the open card out of a filtered list, and the walk
 *  must still step to the card that FOLLOWED it, not skip one. */
interface Walk {
    ids: string[];
    index: number;
}

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
    const [walk, setWalk] = useState<Walk | null>(null);
    const [sweep, setSweep] = useState<SweepRow | null>(null);

    const resolvedScope = scope ?? scopes[0]?.setCode;
    const activeScope =
        tab === "capabilities" ? CUBE_SOURCE_KEY : resolvedScope;
    const cards = useScopeCardProfiles(activeScope);
    const {
        setCapabilities,
        setArchetypes,
        clearCapabilities,
        clearArchetypes,
    } = useCardProfileMutations();
    const archetypeCatalogue = useArchetypeCatalogue();
    const { createRow, updateRow } = useArchetypeCatalogueMutations();

    const sortable = TAB_COLUMNS[tab].includes(sort.key) ? sort : DEFAULT_SORT;
    const visible = useMemo(
        () =>
            cards
                ? sortCards(filterCards(cards, filters, tab), sortable, tab)
                : undefined,
        [cards, filters, sortable, tab]
    );
    const progress = reviewProgress(cards, tab);
    const openCardId = walk ? walk.ids[walk.index] : null;
    const openCard =
        openCardId === null
            ? null
            : (cards?.find((card) => card.cardId === openCardId) ?? null);

    function resetView() {
        setFilters(EMPTY_FILTERS);
        setSort(DEFAULT_SORT);
        setWalk(null);
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

    function openRow(cardId: string) {
        const ids = (visible ?? []).map((card) => card.cardId);
        const index = ids.indexOf(cardId);
        if (index !== -1) setWalk({ ids, index });
    }

    /** Steps the walk; past its last card the dialog closes. */
    function step(delta: 1 | -1) {
        setWalk((prev) => {
            if (prev === null) return null;
            const index = prev.index + delta;
            if (index < 0) return prev;
            return index >= prev.ids.length ? null : { ...prev, index };
        });
    }

    /** Writes ONLY `layer`'s row (ADR 0167, issue #8904): "Mark reviewed" on
     *  the Archetypes tab never flips the Capability flag, nor the reverse. */
    function saveToLayer(
        layer: ProfileTab,
        card: ScopeCardProfile,
        save: LayerSave
    ) {
        if (layer === "capabilities") {
            return setCapabilities({
                cardId: card.cardId,
                provides: save.provides,
                requires: save.requires,
                comboEdges: effectiveProfile(card)?.comboEdges,
                reviewed: save.reviewed,
            });
        }
        if (activeScope === undefined) {
            return Promise.reject(new Error("No scope selected"));
        }
        return setArchetypes({
            scope: activeScope,
            cardId: card.cardId,
            archetypes: save.archetypes,
            reviewed: save.reviewed,
        });
    }

    function clearLayer(card: ScopeCardProfile) {
        if (tab === "capabilities") {
            return clearCapabilities({ cardId: card.cardId });
        }
        if (activeScope === undefined) {
            return Promise.reject(new Error("No scope selected"));
        }
        return clearArchetypes({ scope: activeScope, cardId: card.cardId });
    }

    /** The sweep board writes the layer of the row it sweeps. */
    function saveProfile(cardId: string, profile: EditableCardProfile) {
        const card = cards?.find((entry) => entry.cardId === cardId);
        if (card === undefined || sweep === null) return Promise.resolve(null);
        return saveToLayer(sweepTab(sweep.kind), card, profile);
    }

    const sweepDescription =
        sweep === null
            ? undefined
            : sweep.kind === "archetype"
              ? archetypeCatalogue.find((row) => row.id === sweep.id)
                    ?.description
              : CAPABILITY_REGISTRY.find((row) => row.id === sweep.id)
                    ?.description;

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
                        onCreateRow={(row) => createRow({ row })}
                        onUpdateRow={(row) => updateRow({ row })}
                        residues={residueForScope(
                            CENSUS_RESIDUE_FILES,
                            resolvedScope
                        )}
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
                                onOpen={openRow}
                            />
                        )}
                    </>
                )}
            </div>
            <CardProfileFocusDialog
                tab={tab}
                card={openCard}
                index={walk?.index ?? 0}
                total={walk?.ids.length ?? 0}
                scopeCards={cards ?? []}
                archetypeCatalogue={archetypeCatalogue}
                onSave={(card, save) => saveToLayer(tab, card, save)}
                onClear={clearLayer}
                onPrev={walk !== null && walk.index > 0 ? () => step(-1) : null}
                onNext={() => step(1)}
                onClose={() => setWalk(null)}
            />
        </div>
    );
}
