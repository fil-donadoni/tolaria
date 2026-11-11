import { useMemo, useState } from "react";
import { useDraftableSets } from "~/hooks/useLimitedEvent";
import { useArchetypeCatalogue } from "~/hooks/useCardProfiles";
import {
    useCardRatingMutations,
    useScopeCardRatings,
    type ScopeCardRating,
} from "~/hooks/useCardRatings";
import type { SortState } from "~/lib/adminTableSort";
import AdminScopeRail from "../tool/admin-scope-rail";
import PickRatingsDialog from "./pick-ratings-dialog";
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

/** The dialog's walk: the table's order FROZEN when a row opens, so a rating
 *  change that re-sorts the table never changes which card Next shows.
 *  `detours` is the stack of neighbours opened to reposition them; the open
 *  card is the top of it, else the walk's own. */
interface Walk {
    ids: string[];
    index: number;
    detours: string[];
}

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
    const [walk, setWalk] = useState<Walk | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const resolvedScope = scope ?? scopes[0]?.setCode;
    const cards = useScopeCardRatings(resolvedScope);
    const archetypeCatalogue = useArchetypeCatalogue();
    const { setRating, clearRating } = useCardRatingMutations();

    const visible = useMemo(
        () =>
            cards ? sortCards(filterCards(cards, filters), sort) : undefined,
        [cards, filters, sort]
    );
    const types = useMemo(() => typeOptions(cards), [cards]);

    const walkIds = walk ? [walk.ids[walk.index], ...walk.detours] : [];
    const openCardId = walkIds.at(-1) ?? null;
    const openCard =
        openCardId === null
            ? null
            : (cards?.find((card) => card.cardId === openCardId) ?? null);
    // Back names the card the detour started from, or the previous detour.
    const backToId =
        walk && walk.detours.length > 0 ? (walkIds.at(-2) ?? null) : null;
    const backToName =
        backToId === null
            ? null
            : (cards?.find((card) => card.cardId === backToId)?.name ?? null);

    function openRow(cardId: string) {
        const ids = (visible ?? []).map((card) => card.cardId);
        const index = ids.indexOf(cardId);
        if (index !== -1) setWalk({ ids, index, detours: [] });
    }

    function jumpTo(cardId: string) {
        setWalk((prev) =>
            prev === null
                ? prev
                : { ...prev, detours: [...prev.detours, cardId] }
        );
    }

    /** Next in the walk; on a detour, Back to the card it started from. Past
     *  the walk's last card the dialog closes. */
    function next() {
        setWalk((prev) => {
            if (prev === null) return null;
            if (prev.detours.length > 0)
                return { ...prev, detours: prev.detours.slice(0, -1) };
            const index = prev.index + 1;
            return index >= prev.ids.length ? null : { ...prev, index };
        });
    }

    function prev() {
        setWalk((cur) =>
            cur === null || cur.detours.length > 0 || cur.index === 0
                ? cur
                : { ...cur, index: cur.index - 1 }
        );
    }

    /** One write at a time: every rating control waits for it. */
    async function write(save: () => Promise<unknown>) {
        setSaving(true);
        setSaveError(null);
        try {
            await save();
        } catch (error) {
            setSaveError(
                error instanceof Error
                    ? error.message
                    : "The rating was not saved."
            );
        } finally {
            setSaving(false);
        }
    }

    function rate(card: ScopeCardRating, rating: number) {
        if (resolvedScope === undefined) return;
        void write(() =>
            setRating({ scope: resolvedScope, cardId: card.cardId, rating })
        );
    }

    function clear(card: ScopeCardRating) {
        if (resolvedScope === undefined) return;
        void write(() =>
            clearRating({ scope: resolvedScope, cardId: card.cardId })
        );
    }

    function changeScope(next: string) {
        setWalk(null);
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
                        openCardId={walk ? walk.ids[walk.index] : null}
                        onOpen={openRow}
                    />
                )}
            </div>
            <PickRatingsDialog
                card={openCard}
                all={cards ?? []}
                index={walk?.index ?? 0}
                total={walk?.ids.length ?? 0}
                backToName={backToName}
                saving={saving}
                saveError={saveError}
                onRate={rate}
                onClear={clear}
                onJump={jumpTo}
                onPrev={
                    walk !== null && walk.detours.length === 0 && walk.index > 0
                        ? prev
                        : null
                }
                onNext={next}
                onClose={() => setWalk(null)}
            />
        </div>
    );
}
