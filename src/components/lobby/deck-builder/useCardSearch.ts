import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

export interface CardIndexEntry {
    _id: string;
    cardId: string;
    name: string;
    nameLower: string;
    types: string[];
    subtypes: string[];
    colors: string[];
    manaValue: number;
    oracleText: string;
}

export type ColorMode = "exact" | "include-all" | "include-any";

export interface CardSearchFilters {
    text: string;
    colors: string[];
    /** Match colorless cards (no color identity). Independent of `colors` set. */
    includeColorless: boolean;
    colorMode: ColorMode;
    types: string[];
    /** Selected mana values. `7` is treated as "7 or more". */
    manaValues: number[];
}

export const DEFAULT_FILTERS: CardSearchFilters = {
    text: "",
    colors: [],
    includeColorless: false,
    colorMode: "include-any",
    types: [],
    manaValues: [],
};

const setEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((c) => b.includes(c));

function matchesColors(
    cardColors: string[],
    filters: CardSearchFilters
): boolean {
    const hasColorSelection = filters.colors.length > 0;
    if (!hasColorSelection && !filters.includeColorless) return true;

    if (filters.includeColorless && cardColors.length === 0) return true;
    if (!hasColorSelection) return false;

    switch (filters.colorMode) {
        case "exact":
            return setEqual(cardColors, filters.colors);
        case "include-all":
            return filters.colors.every((c) => cardColors.includes(c));
        case "include-any":
            return filters.colors.some((c) => cardColors.includes(c));
    }
}

function matchesText(entry: CardIndexEntry, text: string): boolean {
    if (!text) return true;
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    return tokens.every(
        (t) => entry.nameLower.includes(t) || entry.oracleText.includes(t)
    );
}

function matchesTypes(types: string[], selected: string[]): boolean {
    if (selected.length === 0) return true;
    return selected.some((t) => types.includes(t));
}

function matchesManaValue(mv: number, selected: number[]): boolean {
    if (selected.length === 0) return true;
    if (selected.includes(7) && mv >= 7) return true;
    return selected.includes(mv);
}

export function useCardSearch(filters: CardSearchFilters): {
    entries: CardIndexEntry[] | undefined;
    total: number;
} {
    const all = useQuery(api.cardIndex.list, {});
    const entries = useMemo(() => {
        if (!all) return undefined;
        const filtered = all.filter(
            (e) =>
                matchesText(e, filters.text) &&
                matchesColors(e.colors, filters) &&
                matchesTypes(e.types, filters.types) &&
                matchesManaValue(e.manaValue, filters.manaValues)
        );
        return filtered.sort(
            (a, b) => a.manaValue - b.manaValue || a.name.localeCompare(b.name)
        );
    }, [all, filters]);

    return { entries, total: all?.length ?? 0 };
}
