import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardPrinting } from "@convex/cards";

export interface CardIndexEntry {
    cardId: string;
    name: string;
    nameLower: string;
    types: string[];
    subtypes: string[];
    supertypes: string[];
    colors: string[];
    manaValue: number;
    oracleText: string;
    prints: CardPrinting[];
}

export type ColorMode = "at-most" | "include-all" | "include-any";

export interface CardSearchFilters {
    text: string;
    colors: string[];
    /** Match colorless cards (no color identity). Independent of `colors` set. */
    includeColorless: boolean;
    colorMode: ColorMode;
    types: string[];
    /** Selected mana values. `7` is treated as "7 or more". */
    manaValues: number[];
    /** Selected set codes. Empty = all sets. A card matches when any of its
     *  printings belongs to a selected set. */
    sets: string[];
}

export const DEFAULT_FILTERS: CardSearchFilters = {
    text: "",
    colors: [],
    includeColorless: false,
    colorMode: "include-any",
    types: [],
    manaValues: [],
    sets: [],
};

function matchesColors(
    cardColors: string[],
    filters: CardSearchFilters
): boolean {
    const hasColorSelection = filters.colors.length > 0;
    if (!hasColorSelection && !filters.includeColorless) return true;

    if (filters.includeColorless && cardColors.length === 0) return true;
    if (!hasColorSelection) return false;
    if (cardColors.length === 0) return false;

    switch (filters.colorMode) {
        case "at-most":
            return cardColors.every((c) => filters.colors.includes(c));
        case "include-all":
            return filters.colors.every((c) => cardColors.includes(c));
        case "include-any":
            return filters.colors.some((c) => cardColors.includes(c));
    }
}

function tokenizeQuery(text: string): string[] {
    const normalized = text.replace(/[“”„‟″‶]/g, '"').replace(/[‘’‚‛′‵]/g, "'");
    const tokens: string[] = [];
    const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
        const t = (m[1] ?? m[2] ?? m[3] ?? "").trim();
        if (t) tokens.push(t);
    }
    return tokens;
}

function matchesText(entry: CardIndexEntry, text: string): boolean {
    if (!text) return true;
    const tokens = tokenizeQuery(text.toLowerCase());
    if (tokens.length === 0) return true;
    return tokens.every(
        (t) => entry.nameLower.includes(t) || entry.oracleText.includes(t)
    );
}

function matchesTypes(entry: CardIndexEntry, selected: string[]): boolean {
    if (selected.length === 0) return true;
    return selected.some(
        (t) =>
            entry.types.includes(t) ||
            entry.subtypes.includes(t) ||
            entry.supertypes.includes(t)
    );
}

function matchesManaValue(mv: number, selected: number[]): boolean {
    if (selected.length === 0) return true;
    if (selected.includes(7) && mv >= 7) return true;
    return selected.includes(mv);
}

export function matchesSets(
    prints: CardPrinting[],
    selected: string[]
): boolean {
    if (selected.length === 0) return true;
    return prints.some((p) => selected.includes(p.setCode));
}

export function hasAnyFilter(filters: CardSearchFilters): boolean {
    return (
        filters.text.trim().length > 0 ||
        filters.colors.length > 0 ||
        filters.includeColorless ||
        filters.types.length > 0 ||
        filters.manaValues.length > 0 ||
        filters.sets.length > 0
    );
}

export function useCardSearch(filters: CardSearchFilters): {
    entries: CardIndexEntry[] | undefined;
    total: number;
    /** True when no filter is set — caller should suppress result rendering
     *  (and the associated image fetches) until the user narrows the set. */
    idle: boolean;
} {
    const all = useQuery(api.cardIndex.list, {});
    const idle = !hasAnyFilter(filters);
    const entries = useMemo(() => {
        if (!all) return undefined;
        if (idle) return [];
        const filtered = all.filter(
            (e) =>
                matchesText(e, filters.text) &&
                matchesColors(e.colors, filters) &&
                matchesTypes(e, filters.types) &&
                matchesManaValue(e.manaValue, filters.manaValues) &&
                matchesSets(e.prints, filters.sets)
        );
        return filtered.sort(
            (a, b) => a.manaValue - b.manaValue || a.name.localeCompare(b.name)
        );
    }, [all, filters, idle]);

    return { entries, total: all?.length ?? 0, idle };
}
