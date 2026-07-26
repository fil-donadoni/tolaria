// Human name for a Limited Event. The wire carries the raw machine shape —
// `type: "draft"` plus `packSlots: ["vintage-cube", "vintage-cube",
// "vintage-cube"]` (one entry PER BOOSTER, so a 3-pack draft repeats its
// source three times) — which rendered literally reads
// "draft — VINTAGE-CUBE, VINTAGE-CUBE, VINTAGE-CUBE". The repetition carries
// no information a player wants: the pack COUNT is already visible as
// "Booster 1 of 3". So the label collapses `packSlots` to its DISTINCT sources
// (order preserved — a multi-set block draft like INV/PLS/APC is drafted in
// that order) and names each one, then appends the event type.
import { setName } from "@convex/cards/setMeta";
import { CUBE_DISPLAY_NAME, isCubeSource } from "@convex/limited/cubeSource";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";

const TYPE_LABEL: Record<LimitedEventView["type"], string> = {
    draft: "Draft",
    sealed: "Sealed",
};

/** The display name of one Pack Source: the cube's own label, or the set's
 *  full name (`setName` falls back to the upper-cased code for a set with no
 *  registered name yet). */
export function packSourceName(source: string): string {
    return isCubeSource(source) ? CUBE_DISPLAY_NAME : setName(source);
}

/**
 * Full event name — "Vintage Cube Draft", "Limited Edition Alpha Sealed", or
 * "Invasion / Planeshift / Apocalypse Draft" for a multi-set block draft.
 */
export function limitedEventName(
    event: Pick<LimitedEventView, "type" | "packSlots">
): string {
    const sources = [...new Set(event.packSlots)].map(packSourceName);
    const type = TYPE_LABEL[event.type];
    // A zero-slot event can't be created (`createLimitedEvent` rejects an
    // empty `packSlots`), but a name is a display concern — degrade to the
    // bare type rather than rendering a dangling separator.
    return sources.length === 0 ? type : `${sources.join(" / ")} ${type}`;
}
