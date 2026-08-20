import type { CSSProperties } from "react";
import {
    BESIDE_CONTROLLER_STRIP,
    CONTROLLER_STRIP_CLEARANCE_EXPR,
} from "./controller-bar-metrics";
import { rowLayout, type Placement } from "./board-layout";

/** The LANDSCAPE-COMPACT vertical budget of the board (#1768) — the lateral
 *  twin of `portrait-board-bands.ts` (#1760), for a phone held sideways.
 *
 *      ┌───────┬────────────────────────────┬──────┬────┐ 0
 *      │       │ opponent hand (backs)      │      │    │ ─ opp hand band
 *      │ seat  ├────────────────────────────┤ pile │ c  │
 *      │ chrome│ opponent battlefield       │ rail │ t  │
 *      │ (left ├────────────────────────────┤      │ r  │ ← midline
 *      │ rail) │ viewer battlefield         │      │ l  │
 *      │       ├────────────────────────────┤      │    │
 *      │       │ viewer hand                │      │    │ ─ hand band
 *      └───────┴────────────────────────────┴──────┴────┘ 100%
 *
 *  **The bug this module exists to kill.** Until #1763 landed there was no
 *  `landscape-compact` mode at all, so a landscape phone fell through to the
 *  DESKTOP board: `top-[18%] h-[32%]` battlefield bands and a full-size
 *  {@link fanLayout} hand. On a 390px-tall viewport that meant a battlefield
 *  band of ~125px split into two rows, i.e. a per-row card cap of ~49×35px
 *  (unreadable, barely tappable) — while the hand next to it kept rendering at
 *  the full 120×168 desktop footprint, because the hand zone paints
 *  `overflow-visible` and never shrank. Board and hand were on two unrelated
 *  scales, and the smaller one was the one you have to play with.
 *
 *  **The fix is ONE budget with ONE card scale.** The fractions below are
 *  chosen so that
 *
 *      LANDSCAPE_BATTLEFIELD_FRAC / LANDSCAPE_BATTLEFIELD_ROWS
 *          === LANDSCAPE_VIEWER_HAND_FRAC
 *
 *  — a battlefield ROW and the hand band are the same height. That equality is
 *  the whole design: one card footprint ({@link landscapeCardMetrics}) fits
 *  both, so the hand and the battlefield can be handed the SAME `cardWidth` /
 *  `cardHeight` and cards read at one size across the board. It is asserted by
 *  `src/lib/__tests__/landscape-board-bands.test.ts`, so the two can't drift.
 *
 *  Height is the scarce dimension here, so the horizontal one pays for
 *  everything that is NOT cards: seat chrome (nameplate + mana pool) gets a
 *  fixed LEFT rail and the piles get a one-tile-wide column beside the control
 *  strip (#1769). Both rails are subtracted from every band, so a nameplate or
 *  a pile can never sit on top of a card — the same "make the overlap
 *  arithmetically impossible" move #1760 made vertically for portrait.
 *
 *  Values are published as CSS custom properties on the board root (not inline
 *  `top`/`bottom`) for the same reason the portrait budget is: the classes stay
 *  literal so Tailwind can see them, and one shared variable can be read by
 *  chrome that must follow the midline (the seat nameplates) without
 *  re-deriving it. Portrait/desktop keep their own classes — this budget is
 *  landscape-only. */

/** Opponent hand band: a SLIVER of card backs. It is information (how many
 *  cards), never an interaction, so it is deliberately shorter than one card —
 *  the zone clips, and the reclaimed height goes to the battlefields. */
export const LANDSCAPE_OPP_HAND_FRAC = 0.1;

/** Viewer hand band. Exactly one card tall (plus {@link LANDSCAPE_BAND_V_PAD}),
 *  which is what pins the shared card scale. */
export const LANDSCAPE_VIEWER_HAND_FRAC = 0.18;

/** Rows a battlefield band is split into by `bandedRowsLayout` (creatures +
 *  the lands/other back row). */
export const LANDSCAPE_BATTLEFIELD_ROWS = 2;

/** One battlefield band — the two seats split whatever the hands leave, evenly,
 *  so both players get the same board height. */
export const LANDSCAPE_BATTLEFIELD_FRAC =
    (1 - LANDSCAPE_OPP_HAND_FRAC - LANDSCAPE_VIEWER_HAND_FRAC) /
    LANDSCAPE_BATTLEFIELD_ROWS;

/** Boundary between the two battlefields, as a fraction of board height. Unlike
 *  portrait there is no bottom bar to pay for (landscape docks its controls to
 *  the right edge, #1769), so the midline is simply where the opponent's band
 *  ends — it is NOT the geometric half, because the two hand bands differ. */
export const LANDSCAPE_MIDLINE_FRAC =
    LANDSCAPE_OPP_HAND_FRAC + LANDSCAPE_BATTLEFIELD_FRAC;

/** Vertical breathing room kept above+below the cards in a band. Much tighter
 *  than the desktop `BAND_V_PAD` (14px): at this card size 14px of padding is
 *  a fifth of the row, and it is spent making cards smaller rather than
 *  separating them. */
export const LANDSCAPE_BAND_V_PAD = 6;

/** Readability floor / ceiling on the shared card height (px). The floor keeps
 *  the shortest phone (iPhone SE landscape, 320px) legible; the ceiling stops a
 *  500px-tall "landscape-compact" tablet from rendering near-desktop cards in a
 *  layout tuned for phones. */
export const LANDSCAPE_MIN_CARD_H = 40;
export const LANDSCAPE_MAX_CARD_H = 96;

/** Inter-card gap in the flat landscape hand row (px). */
export const LANDSCAPE_HAND_GAP = 6;

/** Width of the LEFT rail that holds both seats' chrome (nameplate + life +
 *  mana pool). Every band is inset by it, so seat chrome can never overlap a
 *  card — the acceptance criterion, satisfied by construction rather than by
 *  z-order luck.
 *
 *  `4rem` (issue #2589, was `8rem`) — the phone-landscape density pass: the
 *  ADR 0101 §8 acceptance criterion caps nameplates + the control strip at
 *  ≤25% of an 844px board (`landscape-board-bands.test.ts`'s arithmetic
 *  guard), and the two rails (this one plus {@link LANDSCAPE_RIGHT_RAIL_VAR})
 *  no longer fit that budget at their original width. The seat nameplate now
 *  always renders `compact` here too (`board-player.tsx`, one row instead of
 *  up to five), which is what makes the narrower rail legible. */
export const LANDSCAPE_SIDE_GUTTER = "4rem";

/** Pile tiles are rendered at this fraction of the shared card width. The piles
 *  are a browse affordance, not a play surface, so they give their width back
 *  to the board.
 *
 *  `0.5` (issue #2589, was `0.7`) — part of the same ≤25% width budget as
 *  {@link LANDSCAPE_SIDE_GUTTER} above; the piles are already a scroll-capped
 *  browse affordance (`LANDSCAPE_OPPONENT_PILES_ANCHOR`), not a play surface,
 *  so they give back more of their width first. */
export const LANDSCAPE_PILE_SCALE = 0.5;

// ── Published custom properties ─────────────────────────────────────────────

/** Height of the opponent's hand sliver. */
export const LANDSCAPE_OPP_HAND_BAND_VAR = "--landscape-opp-hand-h";
/** Height of the viewer's hand strip — the reservation the battlefield honours. */
export const LANDSCAPE_HAND_BAND_VAR = "--landscape-hand-h";
/** Top of the viewer's half = bottom of the opponent's. */
export const LANDSCAPE_MIDLINE_VAR = "--landscape-midline";
/** Bottom inset of the opponent battlefield (the midline, from the bottom). */
export const LANDSCAPE_OPP_BF_BOTTOM_VAR = "--landscape-opp-bf-bottom";
/** Width of the left seat-chrome rail. */
export const LANDSCAPE_SIDE_GUTTER_VAR = "--landscape-side-gutter";
/** THE shared card footprint, in px — one scale for hand AND battlefield. */
export const LANDSCAPE_CARD_W_VAR = "--landscape-card-w";
export const LANDSCAPE_CARD_H_VAR = "--landscape-card-h";
/** Width of one pile tile (drives `--card-w-sm` inside the pile rail). */
export const LANDSCAPE_PILE_TILE_VAR = "--landscape-pile-w";
/** Total right-edge reservation: control strip (#1769) + the pile column. */
export const LANDSCAPE_RIGHT_RAIL_VAR = "--landscape-right-rail";

/** The shared card footprint every landscape-compact zone lays out with. */
export type LandscapeCardMetrics = {
    cardWidth: number;
    cardHeight: number;
    /** Vertical padding `bandedRowsLayout` keeps inside each row. */
    bandPad: number;
};

/** Derive the ONE card footprint for a board of `boardHeight` px.
 *
 *  A battlefield row and the hand band are the same height by construction (see
 *  the module doc), so a single expression serves both: the band height minus
 *  the row padding, clamped to the readability window, at the standard 5:7 MTG
 *  aspect. Pure — the same input always yields the same footprint, which is
 *  what lets the hand and the battlefield be handed identical numbers. */
export function landscapeCardMetrics(
    boardHeight: number
): LandscapeCardMetrics {
    const rowHeight = boardHeight * LANDSCAPE_VIEWER_HAND_FRAC;
    // FLOOR, never round: rounding UP by a fraction of a pixel puts the card
    // marginally past its row allowance, which makes `bandedRowsLayout` cap the
    // whole row's scale below 1 — i.e. the battlefield silently renders cards
    // slightly SMALLER than the hand, re-opening the two-scales bug this module
    // exists to close.
    const cardHeight = Math.floor(
        Math.min(
            LANDSCAPE_MAX_CARD_H,
            Math.max(LANDSCAPE_MIN_CARD_H, rowHeight - LANDSCAPE_BAND_V_PAD)
        )
    );
    return {
        cardWidth: Math.round((cardHeight * 5) / 7),
        cardHeight,
        bandPad: LANDSCAPE_BAND_V_PAD,
    };
}

/** A fraction as a CSS percentage, trimmed of float noise (0.46 → "46%"). */
function pct(fraction: number): string {
    return `${Number((fraction * 100).toFixed(4))}%`;
}

// ── Attacker/blocker combat lift (#1770 follow-up from #1802) ──────────────
//
// `useBattlefieldVisualState` lifts a combat-involved creature toward the
// midline by a FIXED `translate-y-8` (32px) — tuned for the desktop card
// (168px tall, so the lift is ~19% of the card). At the landscape-compact
// scale (40-96px cards, {@link landscapeCardMetrics}) that SAME 32px is a much
// bigger fraction of the card — up to half of it at the shared PHONE_H
// footprint — so a declared attacker painted ~25px past the midline, over the
// opponent's own back row. The fix keeps the SAME proportion the desktop lift
// was tuned to (32 / `CARD_HEIGHT` from `board-layout.ts`) but scales it by
// the shared card height instead of a flat px, so the lift is always ~19% of
// whatever card is actually on screen.

/** The desktop lift's proportion of the desktop card height (32px / 168px) —
 *  the ratio the landscape lift is scaled to preserve. */
const DESKTOP_ATTACKER_LIFT_FRACTION = 32 / 168;

/** Landscape-compact attacker/blocker lift (px), derived from the shared card
 *  height so it stays proportional at every board height instead of
 *  overshooting the midline on a small card. */
export function landscapeAttackerLiftPx(cardHeight: number): number {
    return Math.round(cardHeight * DESKTOP_ATTACKER_LIFT_FRACTION);
}

/** Re-scales a `useBattlefieldVisualState` combat-offset class
 *  (`-translate-y-8` / `translate-y-8` / `""`) to the landscape-compact lift.
 *  The desktop classes are Tailwind's fixed spacing scale (no board-height
 *  input), so a literal class can't express the derived px — an inline
 *  `translate` style does instead ({@link landscapeCombatOffsetStyle}); this
 *  helper only decides DIRECTION (toward vs. away from the midline) from the
 *  desktop class, which `useBattlefieldVisualState` still computes unchanged
 *  (shared between every board mode). Returns `0` when the card is not
 *  involved in combat. */
export function landscapeCombatLiftDirection(combatOffset: string): -1 | 0 | 1 {
    if (combatOffset.startsWith("-")) return -1;
    if (combatOffset.length > 0) return 1;
    return 0;
}

/** The landscape band budget, as custom properties for the board root. Applied
 *  unconditionally (the values are inert unless a landscape band class reads
 *  them), alongside `--right-piles-w` and the portrait budget. */
export function landscapeBandVars(boardHeight: number): CSSProperties {
    const { cardWidth, cardHeight } = landscapeCardMetrics(boardHeight);
    return {
        [LANDSCAPE_OPP_HAND_BAND_VAR]: pct(LANDSCAPE_OPP_HAND_FRAC),
        [LANDSCAPE_HAND_BAND_VAR]: pct(LANDSCAPE_VIEWER_HAND_FRAC),
        [LANDSCAPE_MIDLINE_VAR]: pct(LANDSCAPE_MIDLINE_FRAC),
        [LANDSCAPE_OPP_BF_BOTTOM_VAR]: pct(1 - LANDSCAPE_MIDLINE_FRAC),
        [LANDSCAPE_SIDE_GUTTER_VAR]: LANDSCAPE_SIDE_GUTTER,
        [LANDSCAPE_CARD_W_VAR]: `${cardWidth}px`,
        [LANDSCAPE_CARD_H_VAR]: `${cardHeight}px`,
        [LANDSCAPE_PILE_TILE_VAR]: `calc(var(${LANDSCAPE_CARD_W_VAR}) * ${LANDSCAPE_PILE_SCALE})`,
        // The strip publishes its own MEASURED width (#1769), so the board never
        // hard-codes it — the same seam the phase panel anchors to.
        [LANDSCAPE_RIGHT_RAIL_VAR]: `calc(${CONTROLLER_STRIP_CLEARANCE_EXPR} + var(${LANDSCAPE_PILE_TILE_VAR}) + 0.5rem)`,
    } as CSSProperties;
}

// ── Band classes ────────────────────────────────────────────────────────────
// Spelled out literally (never composed from the *_VAR constants) so Tailwind's
// source scanner can see each arbitrary value — same rule as the portrait bands.

/** Opponent hand sliver — the top edge. */
export const LANDSCAPE_OPPONENT_HAND_BAND =
    "absolute left-[var(--landscape-side-gutter)] right-[var(--landscape-right-rail)] top-0 h-[var(--landscape-opp-hand-h)]";

/** Opponent battlefield — from under its hand sliver down to the midline. */
export const LANDSCAPE_OPPONENT_BATTLEFIELD_BAND =
    "absolute left-[var(--landscape-side-gutter)] right-[var(--landscape-right-rail)] top-[var(--landscape-opp-hand-h)] bottom-[var(--landscape-opp-bf-bottom)]";

/** Viewer battlefield — from the midline down to the TOP of the hand strip.
 *  Bottom-anchored to the hand band, never a fixed height. */
export const LANDSCAPE_VIEWER_BATTLEFIELD_BAND =
    "absolute left-[var(--landscape-side-gutter)] right-[var(--landscape-right-rail)] top-[var(--landscape-midline)] bottom-[var(--landscape-hand-h)]";

/** Viewer hand strip — the bottom edge. There is no bottom bar in this mode. */
export const LANDSCAPE_VIEWER_HAND_BAND =
    "absolute left-[var(--landscape-side-gutter)] right-[var(--landscape-right-rail)] bottom-0 h-[var(--landscape-hand-h)]";

// ── Rails ───────────────────────────────────────────────────────────────────

/** Seat chrome lives in the LEFT rail, stacked around the midline: the opponent
 *  just above it, the viewer just below. Capped to the rail width so a long
 *  player name wraps inside the rail instead of growing into the board. */
export const LANDSCAPE_OPPONENT_SEAT_ANCHOR =
    "left-2 top-[var(--landscape-midline)] -translate-y-full -mt-1 max-w-[calc(var(--landscape-side-gutter)-1rem)]";
export const LANDSCAPE_VIEWER_SEAT_ANCHOR =
    "left-2 top-[var(--landscape-midline)] mt-1 max-w-[calc(var(--landscape-side-gutter)-1rem)]";

/** Pile columns, one tile wide, docked BESIDE the control strip (#1769) — the
 *  strip is vertically centred and short, so the corners next to it are free.
 *  Vertical rather than the desktop row: a row of three tiles would cost three
 *  card widths of board, a column costs one.
 *
 *  **Each column is capped at the MIDLINE.** A column grows from its own edge
 *  toward the middle, and the tile count is not fixed at three: companion,
 *  emblems, monarch and city's-blessing tiles appear conditionally. On a 390px
 *  board a compact tile is ~46px wide ⇒ ~64px tall, so an uncapped column
 *  crosses the 46% midline at the FOURTH tile and the two seats' columns
 *  overlap — the opponent's exile sitting on the viewer's graveyard, each
 *  stealing the other's taps. The cap is the same "make the overlap
 *  arithmetically impossible" move the bands themselves make: `max-height` is
 *  the seat's own share of the height (the midline for the opponent, its
 *  complement for the viewer) minus the 0.5rem edge offset and 0.5rem of
 *  clearance, and anything past it SCROLLS inside the column instead of
 *  invading the other seat. Spelled literally (never composed from the *_VAR
 *  constants) so Tailwind's scanner sees each arbitrary value. */
export const LANDSCAPE_OPPONENT_PILES_ANCHOR = `absolute ${BESIDE_CONTROLLER_STRIP} top-2 z-30 flex flex-col items-end gap-1 max-h-[calc(var(--landscape-midline)-1rem)] overflow-y-auto`;
export const LANDSCAPE_VIEWER_PILES_ANCHOR = `absolute ${BESIDE_CONTROLLER_STRIP} bottom-2 z-30 flex flex-col items-end gap-1 max-h-[calc(100%-var(--landscape-midline)-1rem)] overflow-y-auto`;

/** Re-points `--card-w-sm` (the pile-tile width every zone tile is built from)
 *  at the compact landscape tile, so graveyard / library / exile / companion /
 *  emblem tiles all shrink together and keep their shared 5:7 box. */
export function landscapePileVars(): CSSProperties {
    return {
        "--card-w-sm": `var(${LANDSCAPE_PILE_TILE_VAR})`,
    } as CSSProperties;
}

// ── Hand layout ─────────────────────────────────────────────────────────────

/** FLAT hand layout for landscape-compact: a centred row, no arc.
 *
 *  The desktop hand is a fanned arc ({@link fanLayout}) whose dome lift is a
 *  fraction of CARD HEIGHT and whose cards rotate up to 7° each — both spend
 *  VERTICAL space, which is the one thing this mode has none of (a rotated card
 *  is also taller than its box, so it clips against the band). {@link rowLayout}
 *  gives the same auto-overlap behaviour with zero rotation and zero lift, so
 *  the strip is exactly one card tall however many cards are in it. */
export function makeLandscapeHandLayout(
    cardWidth: number
): (count: number, width: number, height: number) => Placement[] {
    return (count, width, height) =>
        rowLayout({
            count,
            width,
            centerY: height / 2,
            cardWidth,
            gap: LANDSCAPE_HAND_GAP,
        });
}
