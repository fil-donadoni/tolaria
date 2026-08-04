import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type FormatId } from "@convex/formats";
import { buildSearch, decodeFilters, decodeFormat } from "./filterSearch";
import type { CardSearchFilters } from "./useCardSearch";

type FiltersUpdater =
    | CardSearchFilters
    | ((prev: CardSearchFilters) => CardSearchFilters);

export interface SearchPatch {
    filters?: FiltersUpdater;
    format?: FormatId;
}

export interface DeckBuilderSearch {
    filters: CardSearchFilters;
    setFilters: (next: FiltersUpdater) => void;
    /** Format seed read back from the URL, so a reload or a shared link opens
     *  the builder on the same Format instead of falling back to Freeform. */
    urlFormat: FormatId | undefined;
    setUrlFormat: (format: FormatId) => void;
    /** Both at once. Two separate calls in one tick would race: each derives
     *  its payload from the same render's search object, so the second write
     *  overwrites the first (the cube selection is set and the Format forced to
     *  Freeform together). */
    updateSearch: (patch: SearchPatch) => void;
}

/** Drop-in replacement for `useState<CardSearchFilters>` that persists the
 *  filter set in the URL query string. Reading derives the filters from the
 *  current search params; writing replaces (not pushes) the URL so the back
 *  button isn't flooded by every keystroke.
 *
 *  Every write is assembled by the pure `buildSearch`, which carries the
 *  non-filter keys (the Format seed) across the replacement. */
export function useFilterSearchParams(): DeckBuilderSearch {
    const search = useSearch({ strict: false }) as Record<string, unknown>;
    const navigate = useNavigate();

    // Structurally stable across renders while the URL is unchanged
    // (TanStack shares search refs), so this memo only re-decodes on edits.
    const filters = useMemo(() => decodeFilters(search), [search]);
    const urlFormat = useMemo(() => decodeFormat(search), [search]);

    const updateSearch = useCallback(
        ({ filters: next, format }: SearchPatch) => {
            const resolved =
                next === undefined
                    ? undefined
                    : typeof next === "function"
                      ? (next as (p: CardSearchFilters) => CardSearchFilters)(
                            decodeFilters(search)
                        )
                      : next;
            const nextSearch = buildSearch(search, {
                filters: resolved,
                format,
            });
            void navigate({ to: ".", search: () => nextSearch, replace: true });
        },
        [navigate, search]
    );

    const setFilters = useCallback(
        (next: FiltersUpdater) => updateSearch({ filters: next }),
        [updateSearch]
    );

    const setUrlFormat = useCallback(
        (format: FormatId) => updateSearch({ format }),
        [updateSearch]
    );

    return { filters, setFilters, urlFormat, setUrlFormat, updateSearch };
}
