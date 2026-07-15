// Serialization between `CardSearchFilters` and the URL query string. Values
// are kept as plain strings so TanStack Router's default search stringifier
// produces clean, human-readable URLs (e.g. `?q=bolt&c=R&t=Instant`). Keys are
// omitted when they hold their default value, so a pristine builder has no
// search string at all.

import {
    DEFAULT_FILTERS,
    type CardSearchFilters,
    type ColorMode,
    type MatchMode,
} from "./useCardSearch";
import { isSortKey } from "./cardSort";

/** Raw, loosely-typed search object as read from / written to the router. */
export type FilterSearch = Record<string, unknown>;

const COLOR_LETTERS = new Set(["W", "U", "B", "R", "G"]);
const COLOR_MODES: ColorMode[] = ["at-most", "include-all", "include-any"];
const MATCH_MODES: MatchMode[] = ["all", "any"];

function asString(v: unknown): string {
    return typeof v === "string" ? v : v == null ? "" : String(v);
}

function splitList(v: unknown): string[] {
    const s = asString(v).trim();
    return s.length === 0
        ? []
        : s
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean);
}

export function encodeFilters(filters: CardSearchFilters): FilterSearch {
    const out: FilterSearch = {};
    if (filters.text.trim()) out.q = filters.text;
    if (filters.colors.length) out.c = filters.colors.join("");
    if (filters.includeColorless) out.cl = "1";
    if (filters.colorMode !== DEFAULT_FILTERS.colorMode)
        out.cm = filters.colorMode;
    if (filters.types.length) out.t = filters.types.join(",");
    if (filters.typeMode !== DEFAULT_FILTERS.typeMode)
        out.tm = filters.typeMode;
    if (filters.manaValues.length) out.mv = filters.manaValues.join(",");
    if (filters.sets.length) out.s = filters.sets.join(",");
    if (filters.setMode !== DEFAULT_FILTERS.setMode) out.sm = filters.setMode;
    if (filters.cube) out.cube = filters.cube;
    if (filters.sort !== DEFAULT_FILTERS.sort) out.sort = filters.sort;
    return out;
}

export function decodeFilters(search: FilterSearch): CardSearchFilters {
    const colorMode = COLOR_MODES.includes(asString(search.cm) as ColorMode)
        ? (asString(search.cm) as ColorMode)
        : DEFAULT_FILTERS.colorMode;
    const typeMode = MATCH_MODES.includes(asString(search.tm) as MatchMode)
        ? (asString(search.tm) as MatchMode)
        : DEFAULT_FILTERS.typeMode;
    const setMode = MATCH_MODES.includes(asString(search.sm) as MatchMode)
        ? (asString(search.sm) as MatchMode)
        : DEFAULT_FILTERS.setMode;
    const sortRaw = asString(search.sort);

    return {
        text: asString(search.q),
        colors: asString(search.c)
            .toUpperCase()
            .split("")
            .filter((ch) => COLOR_LETTERS.has(ch)),
        includeColorless: asString(search.cl) === "1",
        colorMode,
        types: splitList(search.t),
        typeMode,
        manaValues: splitList(search.mv)
            .map((n) => Number.parseInt(n, 10))
            .filter((n) => Number.isInteger(n)),
        sets: splitList(search.s),
        setMode,
        cube: asString(search.cube),
        sort: isSortKey(sortRaw) ? sortRaw : DEFAULT_FILTERS.sort,
    };
}
