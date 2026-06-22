import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardPrinting } from "@convex/cards";
import { foldAccents } from "@convex/cards/textNormalize";
import { FORMAT_RULES, type FormatId } from "@convex/formats";

export interface CardIndexEntry {
    cardId: string;
    name: string;
    nameLower: string;
    /** `nameLower` with diacritics stripped — drives accent-insensitive search. */
    nameFold: string;
    types: string[];
    subtypes: string[];
    supertypes: string[];
    colors: string[];
    manaValue: number;
    oracleText: string;
    /** `oracleText` with diacritics stripped. */
    oracleFold: string;
    prints: CardPrinting[];
}

export type ColorMode = "at-most" | "include-all" | "include-any";

/** Two-way match mode for the type and set multi-selects.
 *  `all` = card must satisfy every selected value; `any` = at least one. */
export type MatchMode = "all" | "any";

export interface CardSearchFilters {
    text: string;
    colors: string[];
    /** Match colorless cards (no color identity). Independent of `colors` set. */
    includeColorless: boolean;
    colorMode: ColorMode;
    types: string[];
    /** How multiple selected types combine. Only relevant with 2+ selected. */
    typeMode: MatchMode;
    /** Selected mana values. `7` is treated as "7 or more". */
    manaValues: number[];
    /** Selected set codes. Empty = all sets. A card matches when any of its
     *  printings belongs to a selected set. */
    sets: string[];
    /** How multiple selected sets combine. Only relevant with 2+ selected. */
    setMode: MatchMode;
}

export const DEFAULT_FILTERS: CardSearchFilters = {
    text: "",
    colors: [],
    includeColorless: false,
    colorMode: "include-any",
    types: [],
    typeMode: "any",
    manaValues: [],
    sets: [],
    setMode: "any",
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

/** Minimum trimmed query length for the text search to engage. Below this the
 *  text query is inert: it neither constrains matching nor counts as an active
 *  filter for idle-detection. */
export const MIN_TEXT_QUERY_LENGTH = 3;

/** Single shared gate for the whole text query (name + aggregated oracle text).
 *  Both `hasAnyFilter` (idle) and `matchesText` (constraint) route through this
 *  so they can never disagree about whether the query is active. */
export function isTextActive(text: string): boolean {
    return text.trim().length >= MIN_TEXT_QUERY_LENGTH;
}

function matchesText(entry: CardIndexEntry, text: string): boolean {
    // Below the 3-char gate the text query is inert — other filters still
    // apply, but the text never constrains results.
    if (!isTextActive(text)) return true;
    // Fold accents so "ifh-bi" matches "Ifh-Bíff Efreet". The index carries
    // pre-folded fields; the query is folded here.
    const tokens = tokenizeQuery(foldAccents(text.toLowerCase()));
    if (tokens.length === 0) return true;
    return tokens.every(
        (t) => entry.nameFold.includes(t) || entry.oracleFold.includes(t)
    );
}

function entryHasType(entry: CardIndexEntry, t: string): boolean {
    return (
        entry.types.includes(t) ||
        entry.subtypes.includes(t) ||
        entry.supertypes.includes(t)
    );
}

function matchesTypes(
    entry: CardIndexEntry,
    selected: string[],
    mode: MatchMode
): boolean {
    if (selected.length === 0) return true;
    return mode === "all"
        ? selected.every((t) => entryHasType(entry, t))
        : selected.some((t) => entryHasType(entry, t));
}

function matchesManaValue(mv: number, selected: number[]): boolean {
    if (selected.length === 0) return true;
    if (selected.includes(7) && mv >= 7) return true;
    return selected.includes(mv);
}

export function matchesSets(
    prints: CardPrinting[],
    selected: string[],
    mode: MatchMode
): boolean {
    if (selected.length === 0) return true;
    const printed = new Set(prints.map((p) => p.setCode));
    return mode === "all"
        ? selected.every((s) => printed.has(s))
        : selected.some((s) => printed.has(s));
}

/**
 * The supertype marking a card as a basic land. Basics are always includable in
 * any format (ADR 0036, issue #514), so the builder never hides them regardless
 * of the format's allowed-set list.
 */
const BASIC_SUPERTYPE = "Basic";

/**
 * Pre-filter gate for the deck-builder card search (issue #514): a card is
 * offered only when one of its printings belongs to a set the deck's Format
 * allows. `allowedSets === null` (Freeform) imposes no filter. Basic lands
 * (`Basic` supertype) are always available regardless of format. This narrows
 * discovery only — the authoritative legality check still lives in
 * `validateDeck` (ADR 0036).
 */
export function matchesFormatSets(
    prints: CardPrinting[],
    supertypes: string[],
    allowedSets: string[] | null
): boolean {
    if (allowedSets === null) return true; // Freeform: every set.
    if (supertypes.includes(BASIC_SUPERTYPE)) return true; // basics always legal.
    const allowed = new Set(allowedSets);
    return prints.some((p) => allowed.has(p.setCode));
}

export function hasAnyFilter(filters: CardSearchFilters): boolean {
    return (
        isTextActive(filters.text) ||
        filters.colors.length > 0 ||
        filters.includeColorless ||
        filters.types.length > 0 ||
        filters.manaValues.length > 0 ||
        filters.sets.length > 0
    );
}

export function useCardSearch(
    filters: CardSearchFilters,
    // The deck's Format (issue #514). Its `allowedSets` pre-constrain the search
    // to legally-includable prints; omitted (or Freeform) imposes no set gate.
    format?: FormatId
): {
    entries: CardIndexEntry[] | undefined;
    total: number;
    /** True when no filter is set — caller should suppress result rendering
     *  (and the associated image fetches) until the user narrows the set. */
    idle: boolean;
} {
    const all = useQuery(api.cardIndex.list, {});
    const idle = !hasAnyFilter(filters);
    // The format's allowed-set list (null = any set). Resolved here so the gate
    // never hardcodes set codes — it reads them from the Format registry.
    const allowedSets =
        format === undefined ? null : FORMAT_RULES[format].allowedSets;
    const entries = useMemo(() => {
        if (!all) return undefined;
        if (idle) return [];
        const filtered = all.filter(
            (e) =>
                matchesFormatSets(e.prints, e.supertypes, allowedSets) &&
                matchesText(e, filters.text) &&
                matchesColors(e.colors, filters) &&
                matchesTypes(e, filters.types, filters.typeMode) &&
                matchesManaValue(e.manaValue, filters.manaValues) &&
                matchesSets(e.prints, filters.sets, filters.setMode)
        );
        return filtered.sort(
            (a, b) => a.manaValue - b.manaValue || a.name.localeCompare(b.name)
        );
    }, [all, filters, idle, allowedSets]);

    return { entries, total: all?.length ?? 0, idle };
}
