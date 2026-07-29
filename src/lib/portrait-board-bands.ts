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
 *  - the viewer battlefield's bottom inset is `clearance + hand band + the
 *    reserved nameplate band` (#1814 fixup, below), i.e. it STOPS exactly
 *    where the hand strip starts — one whole nameplate band earlier than
 *    before. It cannot run under the hand however tall the bar has grown,
 *    and it shrinks (the battlefield's own `bandedRowsLayout` rescales its
 *    rows to the height it is given) instead of hiding its back row, and it
 *    cannot run under the reserved nameplate band either.
 *  - the midline moves UP by half of (clearance + the reserved nameplate
 *    band), so both battlefields still get the SAME height even though only
 *    the viewer's own inset carries the nameplate reservation. Without that
 *    the viewer's half would pay for the bar (and now the nameplate) alone
 *    and end up shorter than the opponent's.
 *  - both hand strips use one band height, which is what makes the midline a
 *    clean `50% - (clearance + nameplate band) / 2`.
 *
 *  Values are CSS custom properties (not inline `top`/`bottom`) for the same
 *  reason `--right-piles-w` is: the classes stay literal so Tailwind can see
 *  them, and one shared variable can be read by chrome that must follow a
 *  band boundary without re-deriving it — the stack chip follows the
 *  midline, the viewer nameplate follows the reserved nameplate band's own
 *  boundary (below, #1814 fixup).
 *  Landscape/desktop keep their own classes — this budget is portrait-only. */

/** Height of one hand strip (both seats). A percentage of the board so the
 *  strip scales with the viewport; large enough for the portrait hand's fixed
 *  card height on a phone, and hand-size INDEPENDENT — a 7-card hand scrolls
 *  horizontally ({@link portraitHandScrolls}) rather than growing the strip, so
 *  the reservation below is correct for every hand size. */
export const PORTRAIT_HAND_BAND_H = "16%";

/** Height of one hand strip — the reservation every band above it honours. */
export const PORTRAIT_HAND_BAND_VAR = "--portrait-hand-h";
/** Top of the viewer's half = bottom of the opponent's. Shifted up by half of
 *  (the bar clearance + the reserved nameplate band, #1814 fixup) so both
 *  battlefields stay equal even though only the viewer's inset carries the
 *  nameplate reservation directly — see {@link PORTRAIT_NAMEPLATE_BAND_H}. */
export const PORTRAIT_MIDLINE_VAR = "--portrait-midline";
/** Bottom inset of the opponent battlefield (the midline, from the bottom). */
export const PORTRAIT_OPPONENT_BF_BOTTOM_VAR = "--portrait-opp-bf-bottom";
/** Bottom inset of the viewer battlefield: bar clearance + the hand band +
 *  the reserved nameplate band ({@link PORTRAIT_NAMEPLATE_BAND_VAR}, #1814
 *  fixup) — the battlefield now stops ABOVE the nameplate's own territory,
 *  not at its bottom edge, so no back-row card can ever render underneath a
 *  nameplate that grows upward. */
export const PORTRAIT_VIEWER_BF_BOTTOM_VAR = "--portrait-viewer-bf-bottom";

/** Height reserved for the VIEWER nameplate band, sandwiched between the
 *  viewer battlefield and the hand band (#1814 fixup). Before this, the
 *  nameplate anchored AT the battlefield's own bottom edge
 *  (`PORTRAIT_VIEWER_BF_BOTTOM_VAR`) and grew UPWARD *into* that same
 *  battlefield territory — `absolute`, un-clipped, and dead-center
 *  horizontally, exactly where `splitRowLayout` (`board-layout.ts`) centers
 *  the back row (lands) whenever one side is empty, i.e. from turn 1. On a
 *  844px board that covered ~59% of a land card; on a 667px board, ~85% —
 *  and the nameplate carries an `onClick` with no `pointer-events-none`, so
 *  those lands were also untappable (the #1760 bug class).
 *
 *  The fix mirrors the "rail" move `LANDSCAPE_SIDE_GUTTER` already makes
 *  laterally for landscape-compact seat chrome: give the nameplate its OWN
 *  band, subtracted from the battlefield's bottom inset, so the collision is
 *  arithmetically impossible rather than "usually small enough". The
 *  nameplate still anchors at the SAME boundary it always has
 *  ({@link PORTRAIT_NAMEPLATE_BOTTOM_VAR}, the hand band's top edge) and
 *  grows upward — but the battlefield's own bottom inset now stops one whole
 *  band above that, so the back row can never land underneath it.
 *
 *  **Round-2 review fixup — the fixed 5.5rem (88px) reservation above was
 *  itself a bug, just a different one.** Sized to the DESKTOP nameplate's
 *  worst case (life + name on separate lines, a poison row, an energy row),
 *  it traded the #1814 overlap for a worse regression: on a 667×106 phone it
 *  left the viewer battlefield's two rows ~63px tall each — a 120×168 card
 *  scales down to **35×49px**, under the 44px touch-target floor, so the
 *  fix made lands untappable via the OTHER mechanism (too small to hit
 *  instead of hidden under the nameplate). It also folded half its 88px into
 *  the midline split (see {@link PORTRAIT_MIDLINE_VAR}), shrinking the
 *  OPPONENT's battlefield from 169.8px to 125.8px too, for a card the
 *  opponent's own chrome never needed to be that tall for.
 *
 *  The real fix is a SMALLER worst case, not a bigger reservation:
 *  `PlayerNameplate`'s `compact` variant (portrait only, `player-nameplate.tsx`)
 *  puts life + name + BOTH counter badges on ONE row instead of up to five,
 *  with an explicit `leading-none` (or a fixed-height glyph) on every piece —
 *  no inherited/ambiguous line-height, no anonymous-inline-box strut, so the
 *  row's height is exactly its tallest child's font-size and nothing else.
 *  {@link PORTRAIT_NAMEPLATE_MAX_H} is that compact box's derivation, in px,
 *  built from named sub-constants that mirror the component's own classes —
 *  this constant and the compact JSX are meant to be read side by side, and
 *  a change to one that isn't mirrored in the other is exactly what
 *  `PORTRAIT_NAMEPLATE_MAX_H`'s dedicated test (`portrait-board-bands.test.ts`)
 *  exists to catch. */

/** `border` (1px × 2 edges) on the nameplate box. */
export const PORTRAIT_NAMEPLATE_BORDER_PX = 2;
/** Compact-variant vertical padding: `py-0.5` = 0.125rem × 2 edges × 16px. */
export const PORTRAIT_NAMEPLATE_PADDING_PX = 4;
/** The compact variant's ONE content row (life + name + both counter badges,
 *  all inline, `flex` not `inline-flex` so none of them sit in an anonymous
 *  line box that would otherwise take a strut from an inherited line-height).
 *  The row's height is its TALLEST child's own explicit line box: the life
 *  total's `text-lg leading-none` = 1.125rem × 1 × 16px = 18px. Name
 *  (`text-[9px] leading-none` = 9px) and each counter badge (`text-[11px]
 *  leading-none` = 11px) are both shorter, so they never grow the row —
 *  unlike the pre-fixup name line, which had NO `leading-*` utility and so
 *  silently inherited the ambient 1.5 line-height (`text-[10px]` rendering at
 *  15px, not 10) — finding 2 of the round-2 review. */
export const PORTRAIT_NAMEPLATE_ROW_PX = 18;
/** The compact box's total content height (border + padding + the one row),
 *  in px — the real worst case `PlayerNameplate`'s `compact` variant can
 *  render, derived from the sub-constants above rather than eyeballed. */
export const PORTRAIT_NAMEPLATE_MAX_H =
    PORTRAIT_NAMEPLATE_BORDER_PX +
    PORTRAIT_NAMEPLATE_PADDING_PX +
    PORTRAIT_NAMEPLATE_ROW_PX;
/** Rendering-tolerance safety margin (sub-pixel rounding, browser font-metric
 *  variance at `line-height: 1`) — a small FIXED buffer on top of the exact
 *  box math above, not a hand-tuned fudge chosen to hit a target size. */
export const PORTRAIT_NAMEPLATE_SAFETY_PX = 2;
/** The published reservation: the compact box's real worst case plus the
 *  safety margin, expressed in rem (so it scales with the root font size like
 *  every other length in this budget) rather than retyped as a literal. At a
 *  16px root this is exactly `(24 + 2) / 16 = 1.625rem` — no rounding. */
export const PORTRAIT_NAMEPLATE_BAND_H = `${
    (PORTRAIT_NAMEPLATE_MAX_H + PORTRAIT_NAMEPLATE_SAFETY_PX) / 16
}rem`;
export const PORTRAIT_NAMEPLATE_BAND_VAR = "--portrait-nameplate-h";

/** Bottom inset of the nameplate band itself — the boundary the nameplate
 *  anchors to and grows upward from: bar clearance + the hand band, i.e. the
 *  hand band's own TOP edge. Numerically this is what
 *  {@link PORTRAIT_VIEWER_BF_BOTTOM_VAR} used to be before the nameplate
 *  band was carved out of the battlefield's inset; kept as its own named var
 *  so the nameplate's anchor point doesn't have to re-derive it. */
export const PORTRAIT_NAMEPLATE_BOTTOM_VAR = "--portrait-nameplate-bottom";

/** The band budget, as custom properties for the board root. Applied
 *  unconditionally (the values are inert unless a portrait band class reads
 *  them), alongside `--right-piles-w`. */
export function portraitBandVars(): CSSProperties {
    return {
        [PORTRAIT_HAND_BAND_VAR]: PORTRAIT_HAND_BAND_H,
        [PORTRAIT_NAMEPLATE_BAND_VAR]: PORTRAIT_NAMEPLATE_BAND_H,
        [PORTRAIT_MIDLINE_VAR]: `calc(50% - (${CONTROLLER_BAR_CLEARANCE_EXPR} + var(${PORTRAIT_NAMEPLATE_BAND_VAR})) / 2)`,
        [PORTRAIT_OPPONENT_BF_BOTTOM_VAR]: `calc(50% + (${CONTROLLER_BAR_CLEARANCE_EXPR} + var(${PORTRAIT_NAMEPLATE_BAND_VAR})) / 2)`,
        [PORTRAIT_NAMEPLATE_BOTTOM_VAR]: `calc(${CONTROLLER_BAR_CLEARANCE_EXPR} + var(${PORTRAIT_HAND_BAND_VAR}))`,
        [PORTRAIT_VIEWER_BF_BOTTOM_VAR]: `calc(${CONTROLLER_BAR_CLEARANCE_EXPR} + var(${PORTRAIT_HAND_BAND_VAR}) + var(${PORTRAIT_NAMEPLATE_BAND_VAR}))`,
    } as CSSProperties;
}

/** Opponent hand strip — the top edge. */
export const PORTRAIT_OPPONENT_HAND_BAND =
    "absolute left-0 right-0 top-0 h-[var(--portrait-hand-h)]";

/** Opponent battlefield — from under its hand strip down to the midline. */
export const PORTRAIT_OPPONENT_BATTLEFIELD_BAND =
    "absolute left-0 right-0 top-[var(--portrait-hand-h)] bottom-[var(--portrait-opp-bf-bottom)]";

/** Viewer battlefield — from the midline down to the TOP of the reserved
 *  nameplate band (which itself sits atop the hand strip, #1814 fixup).
 *  Bottom-anchored, never a fixed height: that is the whole fix for #1760,
 *  and the nameplate reservation extends the same "cannot be overlapped"
 *  guarantee to the nameplate's own territory. */
export const PORTRAIT_VIEWER_BATTLEFIELD_BAND =
    "absolute left-0 right-0 top-[var(--portrait-midline)] bottom-[var(--portrait-viewer-bf-bottom)]";

/** Viewer hand strip — still anchored to the bar's measured height (#1759);
 *  its height is now the shared band the battlefield above reserves. */
export const PORTRAIT_VIEWER_HAND_BAND = `absolute left-0 right-0 ${ABOVE_CONTROLLER_BAR} h-[var(--portrait-hand-h)]`;

/** For board chrome that must sit ON the midline (stack chip) rather than at
 *  the geometric half of the viewport. */
export const PORTRAIT_MIDLINE_TOP = "top-[var(--portrait-midline)]";

/** For the VIEWER nameplate in portrait (#1814, fixed up post-review): sits
 *  right above the hand band, at {@link PORTRAIT_NAMEPLATE_BOTTOM_VAR} —
 *  mirroring the opponent's top-center nameplate onto the bottom edge
 *  without a hardcoded pixel offset.
 *
 *  Why this boundary and not {@link ABOVE_CONTROLLER_BAR} directly: the hand
 *  band's OWN bottom edge is `ABOVE_CONTROLLER_BAR`, and the portrait hand
 *  (`BoardHandPortrait`, `items-end`) bottom-aligns its cards to that same
 *  edge — cards hug the bar for thumb reach (#1759), the opposite of the
 *  opponent's non-interactive hand, which hugs the battlefield boundary
 *  instead. Anchoring the nameplate at the bar clearance would therefore
 *  land it directly on top of the interactive hand fan; anchoring it at the
 *  hand band's TOP edge (this constant) keeps it clear of the fan by
 *  construction, whatever height the bar or the hand band currently have.
 *
 *  **Post-review fixup:** the nameplate grows UPWARD from this anchor, and it
 *  used to grow into the battlefield's own territory — dead-center
 *  horizontally, exactly where the back row (lands) renders when one side is
 *  empty, from turn 1. `PORTRAIT_VIEWER_BF_BOTTOM_VAR` now reserves a whole
 *  extra {@link PORTRAIT_NAMEPLATE_BAND_H} band above this boundary for
 *  exactly that growth, so the battlefield itself stops short of it — the
 *  collision is arithmetically impossible rather than merely unlikely. See
 *  {@link PORTRAIT_NAMEPLATE_BAND_H} for the full account. */
export const PORTRAIT_VIEWER_NAMEPLATE_BOTTOM =
    "bottom-[var(--portrait-nameplate-bottom)]";

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
