import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardPrinting } from "@convex/cards/catalogue";
import { foldAccents } from "@convex/cards/textNormalize";
import { FORMAT_RULES, type FormatId } from "@convex/formats";
import {
    compareEntries,
    tiebreakForSets,
    type SortKey,
    type SortDirection,
} from "./cardSort";
import {
    type FullCatalogueResult,
    type FullCatalogueRow,
} from "~/lib/fullCatalogue";
import { useScryfallTextSearch } from "~/lib/scryfallApi";
import { parseTypeLine } from "~/lib/typeLine";

// Re-exported so the existing search-side importers keep one import site; the
// parser itself lives in `~/lib/typeLine` because the deck-card shape resolver
// (outside this component tree) needs it too.
export { parseTypeLine };

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
    /** `true` when the card is implemented in Tolaria (available for real decks).
     *  Absent on index entries — defaults to `true` everywhere outside the
     *  unavailable-card path. */
    available?: boolean;
    /** `true` for token cards (CR 111.1 — marker characteristic, not a type).
     *  Absent for index entries, set by `makeCatalogueEntry` from `parseTypeLine`. */
    isToken?: boolean;
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
    /** Selected cube slug (e.g. `"vintage-cube"`), or empty for no cube. A
     *  cube restricts the pool to its member cards (the built ∩ cube list) —
     *  a discovery filter, orthogonal to the deck's Format. */
    cube: string;
    /** Result ordering key. Orthogonal to matching — it never affects which
     *  cards match, only their order, so it is excluded from `hasAnyFilter`. */
    sort: SortKey;
    /** Result ordering direction. Orthogonal to matching, same as `sort`. */
    sortDirection: SortDirection;
    /** Hide unavailable (not-yet-implemented) cards from results. Default `true`
     *  so the real builder never regresses — with this on, results are exactly
     *  today's. Toggling it off surfaces the census of unimplemented cards,
     *  dimmed and unselectable in real mode. */
    hideUnavailable: boolean;
    /** Show only token cards (for the `createToken` manual-mode verb).
     *  Default `false` — tokens are hidden from the regular card pool. */
    showTokens: boolean;
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
    cube: "",
    sort: "manaValue",
    sortDirection: "asc",
    hideUnavailable: true,
    showTokens: false,
};

/** Minimum debounce before a Scryfall oracle-text search fires, per
 *  Scryfall's ≤10 req/s guideline. Separated from the local text debounce
 *  (180ms) so the local search is always faster. */
export const SCRYFALL_DEBOUNCE_MS = 300;

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
    const normalized = text.replace(/[""''""]/g, '"').replace(/['',"']/g, "'");
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
    // Fold accents so "ifh-bi" matches "Ifh-B/ff Efreet". The index carries
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
 * discovery only - the authoritative legality check still lives in
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
        filters.sets.length > 0 ||
        filters.cube.length > 0 ||
        !filters.hideUnavailable ||
        filters.showTokens
    );
}

/**
 * Cube membership gate: a card is offered only when it belongs to the selected
 * cube. `cubeIds === null` means "no cube selected" (no gate). An empty set
 * means the cube resolved to no built members (or is still loading) - nothing
 * matches, rather than falling through to the unfiltered pool.
 */
export function matchesCube(
    cardId: string,
    cardName: string,
    cubeIds: ReadonlySet<string> | null
): boolean {
    if (cubeIds === null) return true;
    return cubeIds.has(cardId) || cubeIds.has(cardName);
}

/**
 * The filters that can be decided from a raw catalogue ROW, before it is
 * turned into a `CardIndexEntry`.
 *
 * Building an entry is not free — `parseTypeLine` splits and re-joins several
 * strings — and the catalogue is ~34,000 rows, so materialising all of them
 * and filtering afterwards means paying that cost 34,000 times to keep (for a
 * cube) 541. These predicates read fields the row already carries, so the
 * expensive step runs only for rows that survive.
 *
 * Deliberately a SUBSET: the type and token gates need the parsed type line,
 * and `matchesFormatSets` needs the print list, so they stay in the main pass.
 * Everything here must agree exactly with its counterpart there — a row this
 * rejects is never seen again.
 */
function rowPassesCheapFilters(
    row: FullCatalogueRow,
    filters: CardSearchFilters,
    cubeIds: ReadonlySet<string> | null,
    textTokens: string[]
): boolean {
    if (!matchesCube(row.printId, row.name, cubeIds)) return false;
    if (!matchesManaValue(row.cmc, filters.manaValues)) return false;
    if (filters.sets.length > 0 && !filters.sets.includes(row.set))
        return false;
    if (textTokens.length > 0) {
        // A catalogue row carries no oracle text, so the name is the only
        // field `matchesText` can match on — mirror exactly that branch.
        for (const token of textTokens) {
            if (!row.nameFold.includes(token)) return false;
        }
    }
    const colors = row.colourIdentity.split("").filter((c) => c !== "");
    return matchesColors(colors, filters);
}

/** The folded, tokenised text query, or `[]` when the query is inert. */
function textQueryTokens(text: string): string[] {
    if (!isTextActive(text)) return [];
    return tokenizeQuery(foldAccents(text.toLowerCase()));
}

export function makeCatalogueEntry(row: FullCatalogueRow): CardIndexEntry {
    const { types, subtypes, supertypes, isToken } = parseTypeLine(
        row.typeLine
    );
    const colors = row.colourIdentity.split("").filter((c) => c !== "");
    return {
        cardId: row.printId,
        name: row.name,
        nameLower: row.name.toLowerCase(),
        nameFold: row.nameFold,
        types,
        subtypes,
        supertypes,
        colors,
        manaValue: row.cmc,
        oracleText: "",
        oracleFold: "",
        prints: [{ printId: row.printId, setCode: row.set }],
        available: row.available,
        isToken,
    };
}

export function useCardSearch(
    filters: CardSearchFilters,
    // The deck's Format (issue #514). Its `allowedSets` pre-constrain the search
    // to legally-includable prints; omitted (or Freeform) imposes no set gate.
    format?: FormatId,
    // Full Catalogue result for manual/real mode merging. When absent (catalogue
    // not yet loaded), the hook falls back to index-only search (today's behavior).
    fullCatalogue?: FullCatalogueResult
): {
    entries: CardIndexEntry[] | undefined;
    total: number;
    /** True when no filter is set - caller should suppress result rendering
     *  (and the associated image fetches) until the user narrows the set. */
    idle: boolean;
} {
    const all = useQuery(api.cardIndex.list, {});
    const catalogueRows = fullCatalogue?.rows;
    const isManual = format === "manual";

    // In manual mode the pool is the entire catalogue (~27K rows) — never
    // gate on idle. The user sees every card immediately; the search box
    // narrows results without a minimum-length threshold.
    const idle = isManual ? false : !hasAnyFilter(filters);
    // The format's allowed-set list (null = any set). Resolved here so the gate
    // never hardcodes set codes - it reads them from the Format registry.
    const allowedSets =
        format === undefined ? null : FORMAT_RULES[format].allowedSets;

    // Cube membership (discovery filter). Only queried when a cube is selected;
    // `"skip"` avoids the round-trip otherwise. `null` = no cube gate; while
    // the query is in flight the set is empty, so a bare cube selection shows
    // nothing until it resolves rather than flashing the whole pool.
    const cubeMembership = useQuery(
        api.cubes.membership,
        filters.cube ? { slug: filters.cube } : "skip"
    );
    const cubeIds = useMemo<ReadonlySet<string> | null>(
        () => (filters.cube ? new Set(cubeMembership ?? []) : null),
        [filters.cube, cubeMembership]
    );

    // Oracle-text search delegated to Scryfall in manual mode (the catalogue
    // carries no oracle text). Debounced separately from the local text so the
    // local name search is always faster, and it degrades silently on failure.
    const scryfallText = useScryfallTextSearch(
        filters.text,
        SCRYFALL_DEBOUNCE_MS,
        isManual && isTextActive(filters.text)
    );

    const entries = useMemo(() => {
        if (!all) return undefined;
        if (idle) return [];

        const parts: CardIndexEntry[] = [];
        // Pre-computed once per pass, not once per row.
        const textTokens = textQueryTokens(filters.text);

        if (isManual && catalogueRows) {
            // Manual mode: the Full Catalogue is the search pool. Every row is
            // selectable regardless of `.available`.
            for (const row of catalogueRows) {
                if (rowPassesCheapFilters(row, filters, cubeIds, textTokens)) {
                    parts.push(makeCatalogueEntry(row));
                }
            }
        } else {
            // Real mode: index entries (available cards) first.
            parts.push(...all);

            // Append catalogue-only rows (unavailable cards) so they show up
            // dimmed and unselectable in real mode.
            if (catalogueRows) {
                const known = new Set(all.map((e) => e.nameFold));
                for (const row of catalogueRows) {
                    if (row.available || known.has(row.nameFold)) continue;
                    if (
                        rowPassesCheapFilters(row, filters, cubeIds, textTokens)
                    ) {
                        parts.push(makeCatalogueEntry(row));
                    }
                }
            }
        }

        // When showTokens is active, only token cards pass through.
        // When off, tokens are excluded from the regular card pool.
        const passesTokenGate = (e: CardIndexEntry) =>
            filters.showTokens ? e.isToken === true : !e.isToken;

        const filtered = parts.filter(
            (e) =>
                passesTokenGate(e) &&
                matchesFormatSets(e.prints, e.supertypes, allowedSets) &&
                matchesCube(e.cardId, e.name, cubeIds) &&
                matchesText(e, filters.text) &&
                matchesColors(e.colors, filters) &&
                matchesTypes(e, filters.types, filters.typeMode) &&
                matchesManaValue(e.manaValue, filters.manaValues) &&
                matchesSets(e.prints, filters.sets, filters.setMode) &&
                // Manual mode shows every card regardless of implementation status.
                (!isManual && filters.hideUnavailable
                    ? e.available !== false
                    : true)
        );

        // In manual mode, supplement local name-search results with Scryfall
        // oracle-text matches. Scryfall results are cross-referenced against
        // the catalogue by name (the catalogue has no oracleId).
        if (
            isManual &&
            catalogueRows &&
            scryfallText.names &&
            scryfallText.names.size > 0
        ) {
            const localNameFolds = new Set(filtered.map((e) => e.nameFold));
            const scryfallNameFolds = new Set(
                [...scryfallText.names].map((n) => foldAccents(n.toLowerCase()))
            );
            for (const row of catalogueRows) {
                if (
                    scryfallNameFolds.has(row.nameFold) &&
                    !localNameFolds.has(row.nameFold)
                ) {
                    const entry = makeCatalogueEntry(row);
                    if (
                        passesTokenGate(entry) &&
                        matchesFormatSets(
                            entry.prints,
                            entry.supertypes,
                            allowedSets
                        ) &&
                        matchesCube(entry.cardId, entry.name, cubeIds) &&
                        matchesColors(entry.colors, filters) &&
                        matchesTypes(entry, filters.types, filters.typeMode) &&
                        matchesManaValue(entry.manaValue, filters.manaValues) &&
                        matchesSets(
                            entry.prints,
                            filters.sets,
                            filters.setMode
                        ) &&
                        (filters.hideUnavailable
                            ? entry.available !== false
                            : true)
                    ) {
                        filtered.push(entry);
                    }
                }
            }
        }

        return filtered.sort(
            compareEntries(
                filters.sort,
                tiebreakForSets(filters.sets),
                filters.sortDirection
            )
        );
    }, [
        all,
        catalogueRows,
        filters,
        idle,
        isManual,
        allowedSets,
        cubeIds,
        scryfallText.names,
    ]);

    return { entries, total: all?.length ?? 0, idle };
}
