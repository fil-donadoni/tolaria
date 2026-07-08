// Pure geometry for the picker's single horizontal strip:
//   [ second zone (bottom / graveyard) ] [ library mock ] [ top zone ]
// One linear x-axis; a card's ZONE is decided by which side of the library it
// lands on. All positions are strip-local px — no React, no side effects, so the
// drag math is a pure function of committed order + live pointer.
import {
    CARD_W,
    REVEAL,
    GAP_FUSED,
    GAP_DETACHED,
    LIB_OVERLAP,
} from "./constants";
import { DECK_W } from "./deck-mock";

export type Zone = "second" | "top";

export type StripLayout = {
    /** Center x of the library mock (the top/second divider for hit-testing). */
    libCenter: number;
    /** Left x of the library mock (for absolute placement). */
    libStart: number;
    /** Total strip width (drives the container + the drag clamp). */
    stripW: number;
    /** Left x and reserved width of the second zone (for the dashed box). */
    secondStart: number;
    secondSlotW: number;
    /** Center x of the card at `index` within `zone`. */
    center: (zone: Zone, index: number) => number;
};

/** Visual width of a `n`-card overlapped fan (0 for an empty fan). */
function zoneWidth(n: number): number {
    return n <= 0 ? 0 : (n - 1) * REVEAL + CARD_W;
}

export function computeLayout(
    secondCount: number,
    topCount: number,
    hasSecond: boolean,
    detached: boolean
): StripLayout {
    const secondStart = 0;
    // Reserve at least one card of room so an EMPTY second zone is still a real,
    // visible drop target (and the library doesn't slam against x=0).
    const secondSlotW = hasSecond
        ? Math.max(zoneWidth(secondCount), CARD_W)
        : 0;
    const gapL = hasSecond ? (detached ? GAP_DETACHED : GAP_FUSED) : 0;
    const libStart = secondSlotW + gapL;
    const libCenter = libStart + DECK_W / 2;
    // The top fan tucks under the library's right edge (Arena fuse).
    const topStart = libStart + DECK_W - LIB_OVERLAP;
    const stripW = topStart + Math.max(zoneWidth(topCount), CARD_W);

    const center = (zone: Zone, index: number): number => {
        const start = zone === "second" ? secondStart : topStart;
        return start + index * REVEAL + CARD_W / 2;
    };

    return { libCenter, libStart, stripW, secondStart, secondSlotW, center };
}

/** Count how many resting slot centers sit left of the pointer → insertion index
 *  for a card dropped at `pointerX` into a zone of `count` cards. */
export function insertionIndex(
    layout: StripLayout,
    zone: Zone,
    count: number,
    pointerX: number
): number {
    let i = 0;
    while (i < count && layout.center(zone, i) < pointerX) i++;
    return i;
}
