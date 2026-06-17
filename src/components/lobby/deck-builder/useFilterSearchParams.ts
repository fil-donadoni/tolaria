import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { decodeFilters, encodeFilters } from "./filterSearch";
import type { CardSearchFilters } from "./useCardSearch";

type FiltersUpdater =
    | CardSearchFilters
    | ((prev: CardSearchFilters) => CardSearchFilters);

/** Drop-in replacement for `useState<CardSearchFilters>` that persists the
 *  filter set in the URL query string. Reading derives the filters from the
 *  current search params; writing replaces (not pushes) the URL so the back
 *  button isn't flooded by every keystroke. */
export function useFilterSearchParams(): [
    CardSearchFilters,
    (next: FiltersUpdater) => void,
] {
    const search = useSearch({ strict: false }) as Record<string, unknown>;
    const navigate = useNavigate();

    // Structurally stable across renders while the URL is unchanged
    // (TanStack shares search refs), so this memo only re-decodes on edits.
    const filters = useMemo(() => decodeFilters(search), [search]);

    const setFilters = useCallback(
        (next: FiltersUpdater) => {
            const resolved =
                typeof next === "function"
                    ? (next as (p: CardSearchFilters) => CardSearchFilters)(
                          decodeFilters(search)
                      )
                    : next;
            void navigate({
                to: ".",
                search: () => encodeFilters(resolved),
                replace: true,
            });
        },
        [navigate, search]
    );

    return [filters, setFilters];
}
