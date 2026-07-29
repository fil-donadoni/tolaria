import type { CSSProperties } from "react";
import {
    ABOVE_CONTROLLER_BAR,
    CONTROLLER_BAR_CLEARANCE_EXPR,
} from "./controller-bar-metrics";

/** The PORTRAIT vertical budget of the board (#1760).
 *
 *  Portrait stacks four bands between the top edge and the bottom bar:
 *
 *      ┌──────────────────────────┐ 0
 *      │ opponent hand strip      │ ─ hand band
 *      ├──────────────────────────┤
 *      │ opponent battlefield     │
 *      ├──────────────────────────┤ ← midline
 *      │ viewer battlefield       │
 *      ├──────────────────────────┤
 *      │ viewer hand strip        │ ─ hand band
 *      ├──────────────────────────┤ ← bar clearance
 *      │ controller bottom bar    │
 *      └──────────────────────────┘ 100%
 *
 *  The bug this module exists to kill: the bands used to be INDEPENDENT fixed
 *  percentages (`top-1/2 h-[32%]` for the viewer battlefield) while the hand
 *  strip floated bottom-anchored above the bar. Nothing tied the two together,
 *  so on a phone the viewer battlefield ran ~140px PAST the top of the hand and
 *  the back row — lands and other noncreatures, centred at
 *  {@link BACK_CENTER_Y_FRAC} of the band — rendered UNDER the hand strip.
 *  With a full hand (7+ cards, where the strip is opaque edge to edge) those
 *  lands could not be tapped for mana at all.
 *
 *  The fix is an explicit budget rather than four unrelated numbers. Every band
 *  is expressed against the two real inputs — the hand strip's height and the
 *  bar's MEASURED clearance ({@link CONTROLLER_BAR_CLEARANCE_EXPR}, #1759) —
 *  and published as CSS custom properties on the board root, so the bands are
 *  arithmetically forced to tile:
 *
 *  - the viewer battlefield's bottom inset is `clearance + hand band`, i.e. it
 *    STOPS exactly where the hand strip starts. It cannot run under the hand
 *    however tall the bar has grown, and it shrinks (the battlefield's own
 *    `bandedRowsLayout` rescales its rows to the height it is given) instead of
 *    hiding its back row.
 *  - the midline moves UP by half the clearance, so both battlefields get the
 *    SAME height. Without that the viewer's half would pay for the bar alone
 *    and end up roughly 40% shorter than the opponent's.
 *  - both hand strips use one band height, which is what makes the midline a
 *    clean `50% - clearance / 2`.
 *
 *  Values are CSS custom properties (not inline `top`/`bottom`) for the same
 *  reason `--right-piles-w` is: the classes stay literal so Tailwind can see
 *  them, and one shared variable can be read by chrome that must follow the
 *  midline (the viewer nameplate, the stack chip) without re-deriving it.
 *  Landscape/desktop keep their own classes — this budget is portrait-only. */

/** Height of one hand strip (both seats). A percentage of the board so the
 *  strip scales with the viewport; large enough for the portrait hand's fixed
 *  card height on a phone, and hand-size INDEPENDENT — a 7-card hand scrolls
 *  horizontally ({@link portraitHandScrolls}) rather than growing the strip, so
 *  the reservation below is correct for every hand size. */
export const PORTRAIT_HAND_BAND_H = "16%";

/** Height of one hand strip — the reservation every band above it honours. */
export const PORTRAIT_HAND_BAND_VAR = "--portrait-hand-h";
/** Top of the viewer's half = bottom of the opponent's. Shifted up by half the
 *  bar clearance so the two battlefields are equal. */
export const PORTRAIT_MIDLINE_VAR = "--portrait-midline";
/** Bottom inset of the opponent battlefield (the midline, from the bottom). */
export const PORTRAIT_OPPONENT_BF_BOTTOM_VAR = "--portrait-opp-bf-bottom";
/** Bottom inset of the viewer battlefield: bar clearance + the hand band. */
export const PORTRAIT_VIEWER_BF_BOTTOM_VAR = "--portrait-viewer-bf-bottom";

/** The band budget, as custom properties for the board root. Applied
 *  unconditionally (the values are inert unless a portrait band class reads
 *  them), alongside `--right-piles-w`. */
export function portraitBandVars(): CSSProperties {
    return {
        [PORTRAIT_HAND_BAND_VAR]: PORTRAIT_HAND_BAND_H,
        [PORTRAIT_MIDLINE_VAR]: `calc(50% - ${CONTROLLER_BAR_CLEARANCE_EXPR} / 2)`,
        [PORTRAIT_OPPONENT_BF_BOTTOM_VAR]: `calc(50% + ${CONTROLLER_BAR_CLEARANCE_EXPR} / 2)`,
        [PORTRAIT_VIEWER_BF_BOTTOM_VAR]: `calc(${CONTROLLER_BAR_CLEARANCE_EXPR} + var(${PORTRAIT_HAND_BAND_VAR}))`,
    } as CSSProperties;
}

/** Opponent hand strip — the top edge. */
export const PORTRAIT_OPPONENT_HAND_BAND =
    "absolute left-0 right-0 top-0 h-[var(--portrait-hand-h)]";

/** Opponent battlefield — from under its hand strip down to the midline. */
export const PORTRAIT_OPPONENT_BATTLEFIELD_BAND =
    "absolute left-0 right-0 top-[var(--portrait-hand-h)] bottom-[var(--portrait-opp-bf-bottom)]";

/** Viewer battlefield — from the midline down to the TOP of the hand strip.
 *  Bottom-anchored, never a fixed height: that is the whole fix for #1760. */
export const PORTRAIT_VIEWER_BATTLEFIELD_BAND =
    "absolute left-0 right-0 top-[var(--portrait-midline)] bottom-[var(--portrait-viewer-bf-bottom)]";

/** Viewer hand strip — still anchored to the bar's measured height (#1759);
 *  its height is now the shared band the battlefield above reserves. */
export const PORTRAIT_VIEWER_HAND_BAND = `absolute left-0 right-0 ${ABOVE_CONTROLLER_BAR} h-[var(--portrait-hand-h)]`;

/** For board chrome that must sit ON the midline (stack chip) rather than at
 *  the geometric half of the viewport. */
export const PORTRAIT_MIDLINE_TOP = "top-[var(--portrait-midline)]";

/** For the VIEWER nameplate in portrait (#1814): sits right above the whole
 *  hand band — the same boundary {@link PORTRAIT_VIEWER_BATTLEFIELD_BAND}
 *  already stops at — mirroring the opponent's top-center nameplate onto the
 *  bottom edge without a hardcoded pixel offset.
 *
 *  Why this boundary and not {@link ABOVE_CONTROLLER_BAR} directly: the hand
 *  band's OWN bottom edge is `ABOVE_CONTROLLER_BAR`, and the portrait hand
 *  (`BoardHandPortrait`, `items-end`) bottom-aligns its cards to that same
 *  edge — cards hug the bar for thumb reach (#1759), the opposite of the
 *  opponent's non-interactive hand, which hugs the battlefield boundary
 *  instead. Anchoring the nameplate at the bar clearance would therefore
 *  land it directly on top of the interactive hand fan; anchoring it at the
 *  hand band's TOP edge (this constant) sits it entirely within the
 *  battlefield's own territory, clear of the fan by construction, whatever
 *  height the bar or the hand band currently have. */
export const PORTRAIT_VIEWER_NAMEPLATE_BOTTOM =
    "bottom-[var(--portrait-viewer-bf-bottom)]";

// ── Portrait hand card metrics (#336, #1770 follow-up from #1790) ──────────
//
// `BoardHandPortrait` used to hard-code a 76px card width — 106.4px tall at
// the standard 5:7 ratio — regardless of the hand band's actual height. That
// is correct only when the band is at least as tall as the card: the band is
// a flat {@link PORTRAIT_HAND_BAND_H} (16%) of the BOARD height, so below
// `106.4 / 0.16 ≈ 665px` (an iOS small viewport, e.g. an iPhone SE in
// Safari's compact toolbar state) the fixed card overflowed the band's TOP
// edge by 10-18px, leaking onto the back row underneath — the exact zone
// #1760 already fixed once, reopened from the other direction. Deriving the
// card's footprint from the SAME band height this module already publishes
// closes it: the card can never be taller than the band that hosts it.

/** The portrait hand's card width above the band-height floor (px) — the
 *  historical fixed size, now a ceiling rather than a constant. */
export const PORTRAIT_HAND_CARD_W_MAX = 76;
/** Overlap between adjacent cards, as a fraction of card width (26/76 at the
 *  historical fixed size) — scales with the derived width instead of staying
 *  a fixed px that would look wrong at a shrunk card size. */
export const PORTRAIT_HAND_OVERLAP_FRAC = 26 / 76;

export type PortraitHandMetrics = {
    /** Card width (px). Height follows from the standard 5:7 aspect ratio. */
    cardWidth: number;
    /** Overlap between adjacent cards (px). */
    overlap: number;
};

/** Derive the portrait hand's card width (and its overlap) from the board
 *  height, so the card's height — `cardWidth * 7/5` — never exceeds the hand
 *  band's actual height. Pure: the same `boardHeight` always yields the same
 *  metrics, mirroring {@link landscapeCardMetrics}'s derivation for the
 *  landscape-compact hand/battlefield footprint. */
export function portraitHandMetrics(boardHeight: number): PortraitHandMetrics {
    const bandHeightPx = boardHeight * (parseFloat(PORTRAIT_HAND_BAND_H) / 100);
    // width <= bandHeight * 5/7 <=> width * 7/5 (height) <= bandHeight.
    const maxWidthForBand = (bandHeightPx * 5) / 7;
    const cardWidth = Math.floor(
        Math.min(PORTRAIT_HAND_CARD_W_MAX, maxWidthForBand)
    );
    return {
        cardWidth,
        overlap: Math.round(cardWidth * PORTRAIT_HAND_OVERLAP_FRAC),
    };
}
