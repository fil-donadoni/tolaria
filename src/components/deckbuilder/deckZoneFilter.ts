// Per-Zone build-time FILTER (ADR 0075, PRD #1617, issue #1625) — a pure,
// MOMENTARY view over one Zone's cards: hides what the player is not
// currently looking at (creature/non-creature + WUBRG+colourless), never
// removes anything from the deck itself.
//
// Deliberately lives beside `deckZoneColumnView.ts` rather than inside
// `convex/deckLayout.ts`. The Column Layout engine's whole job is deciding
// WHICH COLUMN a card lands in, and it is imported by both client and server
// (ADR 0074) because Column Layout IS persisted (`userDecks.layout` /
// `poolArrangement`). The filter never crosses that boundary — it narrows the
// `items` handed to `resolveColumnLayout`, purely client-side, and is never
// read or written anywhere else. Keeping the whole feature out of the
// persisted engine's module is what makes "the filter lives nowhere" (ADR
// 0075 § Persistence split) true by construction rather than by discipline.
import { tryGetDefinition } from "@convex/cards";
import { getCardColorIdentity } from "@convex/cards/colors";
import type { CardDefinition, Color } from "@convex/cards/types";
import type { CardLookup } from "@convex/deckLayout";
import { MANA_COLORS } from "@convex/gre/constants";

/** The segmented creature/non-creature control (issue #1625 AC). `"all"` is
 *  the no-op default — every other Grouping/Ordering/Filter control in this
 *  surface names its no-op the same way. */
export type ZoneCreatureFilter = "all" | "creatures" | "non-creatures";

/** One Zone's build-time filter: the creature segment AND the selected
 *  colours both narrow the same set — "Colour toggles combine with the
 *  creature segment (both must match)" (issue #1625 AC). An empty `colors`
 *  set means "no colour filter", not "match nothing". */
export interface ZoneFilter {
    creature: ZoneCreatureFilter;
    colors: ReadonlySet<Color>;
}

/** The at-rest, filter-off state every Zone starts in on mount — which, since
 *  this filter is held in component state and never persisted, is also the
 *  state every reopen returns to. */
export const DEFAULT_ZONE_FILTER: ZoneFilter = Object.freeze({
    creature: "all" as const,
    colors: new Set<Color>(),
});

export function isZoneFilterActive(filter: ZoneFilter): boolean {
    return filter.creature !== "all" || filter.colors.size > 0;
}

const defaultZoneFilterLookup: CardLookup = (cardId) =>
    tryGetDefinition(cardId) ?? undefined;

/** Whether `def` matches `filter`. A card the caller cannot resolve to a
 *  `CardDefinition` (an unregistered / not-yet-catalogued id, ADR 0080)
 *  always matches — this filter only ever HIDES a card it can positively
 *  classify as non-matching; it never hides a card it cannot classify at
 *  all, which would read as the card silently vanishing rather than as a
 *  filter result. */
export function matchesZoneFilter(
    def: CardDefinition | undefined,
    filter: ZoneFilter
): boolean {
    if (!def) return true;

    const isCreature = def.types.includes("Creature");
    if (filter.creature === "creatures" && !isCreature) return false;
    if (filter.creature === "non-creatures" && isCreature) return false;

    if (filter.colors.size > 0) {
        const identity = getCardColorIdentity(def);
        const matchesColor =
            identity.length === 0
                ? filter.colors.has("C")
                : identity.some((c) => filter.colors.has(c));
        if (!matchesColor) return false;
    }

    return true;
}

/** Narrows `items` to the ones `filter` keeps visible. Returns a NEW array
 *  (never mutates `items`) so a filtered Zone's remaining cards are simply
 *  the ones fed onward to `resolveColumnLayout` — their columns are computed
 *  exactly as if the hidden cards were never in the deck, which is what keeps
 *  "a card that no longer matches disappears without changing which column
 *  its remaining siblings are in" true for free (issue #1625 AC). `lookup`
 *  defaults identically to `resolveColumnLayout`'s own default (the card
 *  registry) so a caller that passes the SAME `lookup` it hands the engine —
 *  as `DeckZoneSurface` does — gets identical classification for a
 *  catalogue-only (Tabletop, ADR 0080) deck too. */
export function filterZoneCards<T>(
    items: readonly T[],
    filter: ZoneFilter,
    cardIdOf: (item: T) => string,
    lookup: CardLookup = defaultZoneFilterLookup
): T[] {
    if (!isZoneFilterActive(filter)) return items.slice();
    return items.filter((item) =>
        matchesZoneFilter(lookup(cardIdOf(item)), filter)
    );
}

const CREATURE_FILTER_LABEL: Record<ZoneCreatureFilter, string> = {
    all: "",
    creatures: "Creatures",
    "non-creatures": "Non-creatures",
};

/** A short human-readable description of the active filter, for the
 *  clearable chip (issue #1625 AC). Empty string when the filter is off —
 *  callers should not render the chip in that case (see
 *  {@link isZoneFilterActive}). WUBRG then colourless — `MANA_COLORS`' own
 *  order, the same one every other colour control in this surface renders
 *  in (`ColorFilter`, the `color` Grouping's columns). */
export function zoneFilterSummary(filter: ZoneFilter): string {
    const parts: string[] = [];
    if (filter.creature !== "all")
        parts.push(CREATURE_FILTER_LABEL[filter.creature]);
    if (filter.colors.size > 0) {
        const codes = MANA_COLORS.filter((c) => filter.colors.has(c));
        parts.push(codes.join("/"));
    }
    return parts.join(" · ");
}

/** Toggles one colour in `filter.colors`, returning a NEW `ZoneFilter` (the
 *  set is never mutated in place — this filter is React state). */
export function toggleZoneFilterColor(
    filter: ZoneFilter,
    color: Color
): ZoneFilter {
    const colors = new Set(filter.colors);
    if (colors.has(color)) colors.delete(color);
    else colors.add(color);
    return { ...filter, colors };
}
