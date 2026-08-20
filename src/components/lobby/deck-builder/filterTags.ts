import {
    DEFAULT_FILTERS,
    isTextActive,
    type CardSearchFilters,
} from "./useCardSearch";

/**
 * Which filter a tag speaks for. The container needs this to route a removal:
 * `text` is NOT a plain `setFilters` write — the search box keeps its own
 * un-debounced copy, which re-applies the query on the next render unless the
 * BOX is cleared — so it gets its own branch at the call site. Everything else,
 * `cube` included, goes through `remove()` unchanged (`deck-builder.tsx`
 * records why the cube branch that used to sit beside it was not real).
 */
export type FilterTagField =
    | "text"
    | "colors"
    | "includeColorless"
    | "types"
    | "manaValues"
    | "sets"
    | "cube"
    | "hideUnavailable"
    | "showTokens";

export interface FilterTag {
    /** Stable within one tag row — `${field}:${value}` for multi-value fields. */
    id: string;
    field: FilterTagField;
    /** What the chip reads. */
    label: string;
    /** Longer accessible name for the × button ("Remove colour White"). */
    removeLabel: string;
    /** The filter set with just this one tag's contribution undone. Pure. */
    remove: (filters: CardSearchFilters) => CardSearchFilters;
}

const COLOR_NAMES: Record<string, string> = {
    W: "White",
    U: "Blue",
    B: "Black",
    R: "Red",
    G: "Green",
};

function withoutValue<T>(values: readonly T[], value: T): T[] {
    return values.filter((v) => v !== value);
}

/** `"vintage-cube"` → `"Vintage Cube"`. The cube's display name lives in the
 *  `cubeLists` DB table, which this pure module deliberately does not reach —
 *  the slug is already the human-facing identifier in the URL. */
export function cubeTagLabel(slug: string): string {
    return slug
        .split("-")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

/**
 * The applied-filter TAG ROW's model (issue #2585).
 *
 * One entry per *value*, not per field: five selected colours are five chips
 * with five ×s, because "remove one" is the affordance the row exists for.
 *
 * The set of fields mirrors `hasAnyFilter` (`useCardSearch.ts`) exactly, and
 * for the same reason it gives: `sort` / `sortDirection` are ORDERING, they
 * never change which cards match, so they are not filters and get no chip. The
 * `colorMode` / `typeMode` / `setMode` selectors are modifiers of a selection
 * rather than a selection — with nothing selected they filter nothing, so they
 * ride on their field's chips instead of carrying their own.
 *
 * `describeActiveFilters(f).length === 0` is therefore equivalent to
 * `!hasAnyFilter(f)`, and that count is what the Filters button badges.
 */
export function describeActiveFilters(filters: CardSearchFilters): FilterTag[] {
    const tags: FilterTag[] = [];

    if (isTextActive(filters.text)) {
        tags.push({
            id: "text",
            field: "text",
            label: `“${filters.text.trim()}”`,
            removeLabel: `Remove text search ${filters.text.trim()}`,
            remove: (f) => ({ ...f, text: "" }),
        });
    }

    for (const color of filters.colors) {
        tags.push({
            id: `colors:${color}`,
            field: "colors",
            label: COLOR_NAMES[color] ?? color,
            removeLabel: `Remove colour ${COLOR_NAMES[color] ?? color}`,
            remove: (f) => ({ ...f, colors: withoutValue(f.colors, color) }),
        });
    }

    if (filters.includeColorless) {
        tags.push({
            id: "includeColorless",
            field: "includeColorless",
            label: "Colorless",
            removeLabel: "Remove colorless",
            remove: (f) => ({ ...f, includeColorless: false }),
        });
    }

    for (const type of filters.types) {
        tags.push({
            id: `types:${type}`,
            field: "types",
            label: type,
            removeLabel: `Remove type ${type}`,
            remove: (f) => ({ ...f, types: withoutValue(f.types, type) }),
        });
    }

    for (const value of filters.manaValues) {
        const shown = value === 7 ? "7+" : String(value);
        tags.push({
            id: `manaValues:${value}`,
            field: "manaValues",
            label: `MV ${shown}`,
            removeLabel: `Remove mana value ${shown}`,
            remove: (f) => ({
                ...f,
                manaValues: withoutValue(f.manaValues, value),
            }),
        });
    }

    for (const setCode of filters.sets) {
        tags.push({
            id: `sets:${setCode}`,
            field: "sets",
            label: setCode.toUpperCase(),
            removeLabel: `Remove set ${setCode.toUpperCase()}`,
            remove: (f) => ({ ...f, sets: withoutValue(f.sets, setCode) }),
        });
    }

    if (filters.cube.length > 0) {
        tags.push({
            id: `cube:${filters.cube}`,
            field: "cube",
            label: cubeTagLabel(filters.cube),
            removeLabel: `Remove cube ${cubeTagLabel(filters.cube)}`,
            remove: (f) => ({ ...f, cube: "" }),
        });
    }

    if (!filters.hideUnavailable) {
        tags.push({
            id: "hideUnavailable",
            field: "hideUnavailable",
            label: "Unavailable shown",
            removeLabel: "Hide unavailable cards again",
            remove: (f) => ({ ...f, hideUnavailable: true }),
        });
    }

    if (filters.showTokens) {
        tags.push({
            id: "showTokens",
            field: "showTokens",
            label: "Tokens",
            removeLabel: "Remove tokens",
            remove: (f) => ({ ...f, showTokens: false }),
        });
    }

    return tags;
}

/**
 * "Clear all" — every MATCHING field back to its default, ordering untouched.
 *
 * Built by folding each tag's own `remove` rather than by splatting
 * `DEFAULT_FILTERS`: that keeps one definition of what a given chip clears, so
 * a new filter cannot be tagged-but-not-cleared (or cleared-but-not-tagged).
 * `sort`/`sortDirection` survive by construction — no chip owns them.
 */
export function clearAllFilters(filters: CardSearchFilters): CardSearchFilters {
    return describeActiveFilters(filters).reduce(
        (acc, tag) => tag.remove(acc),
        filters
    );
}

/** Whether `clearAllFilters` really lands on the defaults for every tagged
 *  field — the invariant `filterTags.test.ts` pins. Exported for that test
 *  rather than duplicated in it. */
export const TAGGED_DEFAULTS: Pick<CardSearchFilters, FilterTagField> = {
    text: DEFAULT_FILTERS.text,
    colors: DEFAULT_FILTERS.colors,
    includeColorless: DEFAULT_FILTERS.includeColorless,
    types: DEFAULT_FILTERS.types,
    manaValues: DEFAULT_FILTERS.manaValues,
    sets: DEFAULT_FILTERS.sets,
    cube: DEFAULT_FILTERS.cube,
    hideUnavailable: DEFAULT_FILTERS.hideUnavailable,
    showTokens: DEFAULT_FILTERS.showTokens,
};
