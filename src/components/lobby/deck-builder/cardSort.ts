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

/** Name is the universal tiebreaker so every sort is stable and deterministic. */
const byName: Comparator = (a, b) => a.name.localeCompare(b.name);

const COMPARATORS: Record<SortKey, Comparator> = {
    name: byName,
    manaValue: (a, b) => a.manaValue - b.manaValue || byName(a, b),
    // Sort by the ORIGINAL printing's set (`prints[0]`, original-first per the
    // card index), then name.
    set: (a, b) =>
        (a.prints[0]?.setCode ?? "").localeCompare(
            b.prints[0]?.setCode ?? ""
        ) || byName(a, b),
    color: (a, b) => colorRank(a) - colorRank(b) || byName(a, b),
};

/** The comparator for a sort key. */
export function compareEntries(key: SortKey): Comparator {
    return COMPARATORS[key];
}
