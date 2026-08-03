// Result ordering for the deck-builder card search. A pure, React-free module
// so the comparators and the colour-rank table can be unit-tested in isolation
// and reused by the URL (de)serialization in `filterSearch.ts`.

import type { CardIndexEntry } from "./useCardSearch";

/** The sort keys the results grid offers. `manaValue` is the default and
 *  preserves the historical ordering (mana value, then name). "Number"
 *  (collector number) is intentionally absent — the card model carries no
 *  collector-number field, so it is deferred rather than faked. */
export type SortKey = "manaValue" | "name" | "set" | "color";

export interface SortOption {
    value: SortKey;
    label: string;
}

/** Display order of the sort dropdown. `manaValue` first because it is the
 *  default selection. */
export const SORT_OPTIONS: readonly SortOption[] = [
    { value: "manaValue", label: "Mana Value" },
    { value: "name", label: "Name" },
    { value: "set", label: "Set" },
    { value: "color", label: "Color" },
] as const;

export const SORT_KEYS: readonly SortKey[] = SORT_OPTIONS.map((o) => o.value);

export function isSortKey(v: string): v is SortKey {
    return (SORT_KEYS as readonly string[]).includes(v);
}

/** Result ordering direction. `asc` is the default and preserves the
 *  historical ordering. */
export type SortDirection = "asc" | "desc";

export function isSortDirection(v: string): v is SortDirection {
    return v === "asc" || v === "desc";
}

// WUBRG canonical colour order (CR 105.1). The colour sort groups cards by
// colour COUNT (mono → 5-colour) and, within a count, by combinatorial WUBRG
// order — the same sequence Scryfall uses:
//   mono:  W U B R G
//   two:   WU WB WR WG UB UR UG BR BG RG
//   three: WUB WUR WUG WBR WBG WRG UBR UBG URG BRG
//   four:  WUBR WUBG WURG WBRG UBRG
//   five:  WUBRG
// Colourless non-lands follow every coloured card; lands sort last regardless
// of the mana they can produce (a Plains derives colour `W`, but a land is
// always placed in the trailing land bucket).
const WUBRG = ["W", "U", "B", "R", "G"] as const;

/** Build a signature → rank map over the 31 non-empty colour subsets, ordered
 *  by (count asc, then combinatorial WUBRG order). The signature is the subset
 *  joined in WUBRG order (e.g. `"WU"`), matching `CardIndexEntry.colors` which
 *  is already emitted in canonical order. */
function buildColorRank(): ReadonlyMap<string, number> {
    const subsets: { size: number; idx: number[]; sig: string }[] = [];
    for (let mask = 1; mask < 1 << WUBRG.length; mask++) {
        const idx: number[] = [];
        for (let b = 0; b < WUBRG.length; b++) {
            if (mask & (1 << b)) idx.push(b);
        }
        subsets.push({
            size: idx.length,
            idx,
            sig: idx.map((i) => WUBRG[i]).join(""),
        });
    }
    subsets.sort((a, b) => {
        if (a.size !== b.size) return a.size - b.size;
        for (let i = 0; i < a.idx.length; i++) {
            if (a.idx[i] !== b.idx[i]) return a.idx[i] - b.idx[i];
        }
        return 0;
    });
    const map = new Map<string, number>();
    subsets.forEach((s, i) => map.set(s.sig, i));
    return map;
}

const COLOR_RANK = buildColorRank();
/** Colourless non-lands sort after every coloured subset. */
const COLORLESS_RANK = COLOR_RANK.size;
/** Lands always sort last, whatever mana they produce. */
const LAND_RANK = COLORLESS_RANK + 1;

function isLandEntry(entry: CardIndexEntry): boolean {
    return entry.types.includes("Land");
}

/** Sort rank for the colour ordering. Lower sorts first. */
export function colorRank(entry: CardIndexEntry): number {
    if (isLandEntry(entry)) return LAND_RANK;
    if (entry.colors.length === 0) return COLORLESS_RANK;
    return COLOR_RANK.get(entry.colors.join("")) ?? COLORLESS_RANK;
}

type Comparator = (a: CardIndexEntry, b: CardIndexEntry) => number;

/** Name is the final tiebreaker so every sort is stable and deterministic. */
const byName: Comparator = (a, b) => a.name.localeCompare(b.name);

const byManaValue: Comparator = (a, b) => a.manaValue - b.manaValue;

/** Card-type ordering for the third sort level: permanents that affect the
 *  board first (creatures → planeswalkers → artifacts → enchantments →
 *  battles), then the spells (instants → sorceries). A card carrying several
 *  types (Artifact Creature) ranks by the FIRST match in this list, so an
 *  Artifact Creature sorts with the creatures. Types outside the list — Land
 *  above all, plus Kindred/Tribal and anything a future set adds — sort last. */
const TYPE_ORDER = [
    "Creature",
    "Planeswalker",
    "Artifact",
    "Enchantment",
    "Battle",
    "Instant",
    "Sorcery",
] as const;

const UNRANKED_TYPE = TYPE_ORDER.length;

/** Sort rank for the type ordering. Lower sorts first. */
export function typeRank(entry: CardIndexEntry): number {
    for (let i = 0; i < TYPE_ORDER.length; i++) {
        if (entry.types.includes(TYPE_ORDER[i])) return i;
    }
    return UNRANKED_TYPE;
}

const byType: Comparator = (a, b) => typeRank(a) - typeRank(b);

/** Primary comparators — the selected sort key alone, no tiebreak baked in.
 *  The tiebreak chain is composed in `compareEntries`. */
const PRIMARY: Record<SortKey, Comparator> = {
    name: byName,
    manaValue: byManaValue,
    // Sort by the ORIGINAL printing's set (`prints[0]`, original-first per the
    // card index).
    set: (a, b) =>
        (a.prints[0]?.setCode ?? "").localeCompare(b.prints[0]?.setCode ?? ""),
    color: (a, b) => colorRank(a) - colorRank(b),
};

/** Secondary ordering applied within a primary-key tie. `name` when the search
 *  is scoped to one or more sets — the results then read like a set list, where
 *  alphabetical is the natural second axis — and `manaValue` otherwise, where a
 *  curve-shaped ordering is more useful than an alphabetical one. */
export type Tiebreak = "name" | "manaValue";

/** Pick the tiebreak from the active filters: a set filter selects `name`. */
export function tiebreakForSets(sets: readonly string[]): Tiebreak {
    return sets.length > 0 ? "name" : "manaValue";
}

/** The comparator for a sort key: primary key, then the tiebreak, then card
 *  type, then name as the deterministic final fallback (each level a no-op when
 *  it repeats a level already applied above it). */
export function compareEntries(
    key: SortKey,
    tiebreak: Tiebreak = "manaValue",
    direction: SortDirection = "asc"
): Comparator {
    const primary = PRIMARY[key];
    const secondary = tiebreak === "name" ? byName : byManaValue;
    const dirSign = direction === "desc" ? -1 : 1;
    return (a, b) =>
        dirSign *
        (primary(a, b) || secondary(a, b) || byType(a, b) || byName(a, b));
}
