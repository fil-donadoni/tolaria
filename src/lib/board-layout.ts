/**
 * Shared, pure layout math for the new spatial board (`Board`, PRD #249,
 * slice #251). Maps `(card count, container size)` → per-card placements. The
 * same placement data is the single source of truth used to position cards and,
 * later, to anchor target arrows — so positions never have to be reverse-
 * engineered from the DOM.
 *
 * DOM-free and side-effect-free: every function here is a pure mapping from
 * numbers to numbers, unit-testable without a renderer. The DOM-validated logic
 * is ported from the throwaway prototype (`src/routes/prototype-board/layout.ts`,
 * `rowLayout` / `fanLayout`) — the prototype dir is slated for deletion, so the
 * proven math lives here instead.
 *
 * Auto-sizing rule (validated by the prototype, tightened by ADR 0103 / issue
 * #2725): cards keep full size and a fixed gap until they would overflow the
 * zone width; past that the inter-card step shrinks (cards overlap) until it
 * reaches the {@link MIN_STEP_FRACTION} floor; past THAT the card itself
 * shrinks ({@link zoneFitScale}) down to {@link MIN_CARD_WIDTH}. Nothing is
 * ever placed off the board, no zone ever scrolls, and no card is ever laid out
 * with its own centre buried under a neighbour.
 */

/** One card's placement within a zone. `x`/`y` are the card *center* in
 *  container pixels; `rotation` is in degrees; `scale` is a uniform multiplier
 *  on the base card size (1 = full size). */
export type Placement = {
    x: number;
    y: number;
    rotation: number;
    scale: number;
};

/** Base card footprint in container pixels. 5:7 aspect ratio (standard MTG). */
export const CARD_WIDTH = 120;
export const CARD_HEIGHT = Math.round((CARD_WIDTH * 7) / 5);

/** Permanent-stack fan reveal (PRD #621, issue #623). A fanned permanent stack
 *  overlaps its members horizontally: member `i` sits `i * offset` px to the
 *  right of the lead. The offset is the resting reveal, clamped so the whole fan
 *  never exceeds {@link STACK_FAN_MAX_WIDTH}. */
export const STACK_FAN_REVEAL = 34;
/** Hard cap on a fanned permanent stack's total visual width (px). */
export const STACK_FAN_MAX_WIDTH = 360;

/** Resting horizontal reveal offset (px) between consecutive members of a fanned
 *  permanent stack of `n` members (PRD #621 "Size-driven presentation",
 *  issue #623). Pure: `min(STACK_FAN_REVEAL, (maxWidth − cardWidth) / (n − 1))`
 *  so the fan stays under {@link STACK_FAN_MAX_WIDTH}. Returns 0 for a single
 *  member (a singleton lays out as one card, no fan). */
export function stackFanOffset(
    n: number,
    cardWidth: number = CARD_WIDTH,
    maxWidth: number = STACK_FAN_MAX_WIDTH
): number {
    if (n <= 1) return 0;
    const clamped = (maxWidth - cardWidth) / (n - 1);
    return Math.min(STACK_FAN_REVEAL, clamped);
}

/** Permanent-stack depth-pile threshold (PRD #621, issue #624). A stack with
 *  **more than** this many members renders as a tight diagonal depth-pile at
 *  ~one-card footprint instead of a wide fan; `≤` this many still fan (#623). */
export const STACK_DEPTH_PILE_THRESHOLD = 8;

/** ×N count-badge minimum stack size (QA): small fans (2–4) already show every
 *  member, so a count badge is noise that only collides with the row above —
 *  it renders from 5 members up. Pure. */
export const STACK_COUNT_BADGE_MIN = 5;

/** Tight per-member diagonal offset (px) of a depth-pile (PRD #621, issue #624).
 *  Members step down-and-right by this much so the whole pile reads as a small
 *  stack of cards within roughly one card's footprint. */
export const STACK_DEPTH_OFFSET = 4;

/** Cap on how many member edges a depth-pile reveals before it stops growing —
 *  beyond this the pile would creep past a one-card footprint, so deeper members
 *  share the bottom edge (the `×N` badge still reports the true count). Keeps the
 *  resting footprint stable regardless of how large the stack gets (issue #624). */
export const STACK_DEPTH_MAX_VISIBLE_EDGES = 6;

/** Whether a permanent stack of `n` members renders as a depth-pile rather than
 *  a fan (PRD #621, issue #624). True strictly above
 *  {@link STACK_DEPTH_PILE_THRESHOLD}. Pure. */
export function isDepthPile(n: number): boolean {
    return n > STACK_DEPTH_PILE_THRESHOLD;
}

/** Resting diagonal offset (px) of member `i` in a depth-pile, clamped so the
 *  pile never exceeds {@link STACK_DEPTH_MAX_VISIBLE_EDGES} card-edges of spread
 *  and thus keeps a ~one-card footprint (PRD #621 "depth-pile", issue #624).
 *  Pure: `min(i, STACK_DEPTH_MAX_VISIBLE_EDGES) * STACK_DEPTH_OFFSET`. */
export function stackDepthOffset(i: number): number {
    return Math.min(i, STACK_DEPTH_MAX_VISIBLE_EDGES) * STACK_DEPTH_OFFSET;
}

/** The horizontal footprint (px) a permanent group occupies on the battlefield
 *  row (issue #977). A singleton is one card wide; a fanned stack (2–8, PRD #621
 *  issue #623) grows RIGHTWARD from its box left edge by `(n-1)·offset`, so its
 *  true footprint is `cardWidth + (n-1)·stackFanOffset(n)`; a depth-pile (>8,
 *  issue #624) keeps a compact resting footprint (`cardWidth + stackDepthOffset`)
 *  because its wide form is a hover-only high-z overlay that floats over
 *  neighbours by design and never reflows the row.
 *
 *  The row layout ({@link rowLayout} / {@link splitRowLayout}) reserves this
 *  width per item so an always-shown fan never overlaps — and steals the clicks
 *  of — the next permanent (the "fixed one-card footprint" simplification broke
 *  exactly here: a 6-card fan is ~290px, far wider than one 120px slot). */
export function stackFootprintWidth(
    n: number,
    cardWidth: number = CARD_WIDTH
): number {
    if (n <= 1) return cardWidth;
    if (isDepthPile(n)) return cardWidth + stackDepthOffset(n - 1);
    return cardWidth + (n - 1) * stackFanOffset(n);
}

/** Default gap between full-size cards before any overlap kicks in. */
const DEFAULT_GAP = 12;

/** Tightest inter-item STEP, as a fraction of the card's own on-screen width
 *  (ADR 0103 "adaptive zone sizing", issue #2725).
 *
 *  It is above 0.5 **by construction**, and that is the whole point. A card's
 *  neighbour paints on top of it, so at a step of `s·w` the neighbour covers
 *  everything from `s·w` rightward: at `s < 0.5` it covers the card's own
 *  CENTRE, and a card whose centre is covered is a card the player cannot
 *  read, cannot click and — measurably — the ui-gate probe counts as `occ`
 *  (`scripts/ui-gate/probe.js` hit-tests the centre of each card's visible
 *  box). The previous value, 0.32, put every crowded row permanently in that
 *  state: a 6-permanent row on a 390px phone stepped by 40% of a card.
 *
 *  0.62 is {@link FAN_STEP_FRACTION}, the reveal the hand fan was already
 *  designed around — so "a card always shows at least 62% of itself" is now
 *  one rule for every zone rather than two different ones. */
export const MIN_STEP_FRACTION = 0.62;

/** Absolute floor (px) on a laid-out card's ON-SCREEN width. Below this a card
 *  is a smudge and overlapping again is the lesser evil, so this is where
 *  {@link zoneFitScale} stops shrinking; it sits far above the 4x4px box the
 *  ui-gate probe scores as `zero`, and matches the smallest card the
 *  landscape-compact band ever asks for (`LANDSCAPE_MIN_CARD_H` 40 at 5:7).
 *
 *  A zone whose BASE card is already at or below this never shrinks at all
 *  (the floor clamps to `scale` 1), so a compact band keeps the one shared
 *  footprint `landscapeCardMetrics` computed for it. */
export const MIN_CARD_WIDTH = 28;

/** The **adaptive per-zone card size** rule (ADR 0103, issue #2725) — the one
 *  place a zone decides how big its cards may be, expressed as a `scale` on the
 *  zone's base card footprint:
 *
 *  ```
 *  scale = min( 1, (zoneWidth − gaps) / Σ footprints )
 *  ```
 *
 *  where "gaps" is the (negative) overlap the {@link MIN_STEP_FRACTION} step
 *  floor still allows. Shrink to fit, so the zone never has to clip a card,
 *  push one off-board, or bury one under its neighbour — and never scroll.
 *
 *  **`footprints` is one entry per laid-out FOOTPRINT, not per card**, and that
 *  distinction is the whole reason this takes an array instead of a count:
 *
 *  - a permanent stack of eight identical Mountains is ONE footprint with a
 *    count badge (`groupBattlefield`, PRD #621) — its entry is the fan/pile
 *    width from {@link stackFootprintWidth}, not eight card widths;
 *  - a TAPPED permanent is ONE ordinary card-wide entry. Its 90°-rotated box
 *    is wider, but it is presentational and `pointer-events: none`, and
 *    reserving the rotated width in the row was MEASURED to make things worse
 *    (issue #1994 / PR #2279 round 2 — it shrank the one shared inter-item gap
 *    for every card in the row and took an untapped fetchland's clickable area
 *    to 0px²). The row stays blind to tap state on purpose.
 *
 *  Pure. Returns 1 when the zone already fits at full size. */
export function zoneFitScale(opts: {
    /** Usable zone width in px (gutters already deducted). */
    zoneWidth: number;
    /** One entry per footprint, at FULL card size. See above. */
    footprints: number[];
    cardWidth?: number;
    /** Override the step floor (defaults to {@link MIN_STEP_FRACTION}). */
    minStepFraction?: number;
    /** Override the legibility floor (defaults to {@link MIN_CARD_WIDTH}). */
    minCardWidth?: number;
}): number {
    const {
        zoneWidth,
        footprints,
        cardWidth = CARD_WIDTH,
        minStepFraction = MIN_STEP_FRACTION,
        minCardWidth = MIN_CARD_WIDTH,
    } = opts;
    const n = footprints.length;
    if (n <= 0 || zoneWidth <= 0 || cardWidth <= 0) return 1;
    const sumW = footprints.reduce((a, b) => a + b, 0);
    // Span of the whole run when every neighbour steps by the floor fraction.
    const floorSpan = sumW + (minStepFraction - 1) * cardWidth * (n - 1);
    if (floorSpan <= zoneWidth) return 1;
    // A base card already under the legibility floor is never shrunk further.
    const scaleFloor = Math.min(1, minCardWidth / cardWidth);
    return Math.max(scaleFloor, zoneWidth / floorSpan);
}

type RowOptions = {
    /** Number of cards in the row. */
    count: number;
    /** Available container width in pixels. */
    width: number;
    /** Vertical center for the whole row, in container pixels. */
    centerY: number;
    /** Base card width (defaults to {@link CARD_WIDTH}). */
    cardWidth?: number;
    /** Gap between full-size cards before overlap (defaults to {@link DEFAULT_GAP}). */
    gap?: number;
    /** Hard upper bound on the row's `scale`, applied AFTER the horizontal fit
     *  math (and below {@link MIN_SCALE} if needed). Used to shrink a row so its
     *  cards fit a limited band HEIGHT — e.g. when the battlefield is split into
     *  creature / other / land rows — so a tall card is never clipped vertically.
     *  The inter-card step is recomputed at the capped scale so spacing stays
     *  tight rather than leaving the cards sparse. */
    maxScale?: number;
    /** Per-item horizontal footprint in px (issue #977). Length must equal
     *  `count`; entry `i` is how wide item `i` actually is on the board (a fanned
     *  permanent stack is wider than one card — {@link stackFootprintWidth}). The
     *  row reserves each item's own width so a wide fan never overlaps its
     *  neighbour's click target. Omitted (or any missing entry) → `cardWidth`,
     *  reproducing the pre-#977 uniform layout EXACTLY. A card's box stays
     *  `cardWidth` wide and centred on the returned `x`; the extra footprint
     *  grows rightward from the box's left edge (the fan's own overlay), so
     *  `x` is always the LEAD (leftmost) member's centre. */
    widths?: number[];
};

/** Fill a per-item width array to length `count`, defaulting any missing entry
 *  to `cardWidth`. A uniform result (every entry `cardWidth`) makes the
 *  variable-width row math reduce to the original uniform layout. */
function normalizeWidths(
    widths: number[] | undefined,
    count: number,
    cardWidth: number
): number[] {
    return Array.from({ length: count }, (_, i) => widths?.[i] ?? cardWidth);
}

/**
 * Auto-sizing row layout (battlefield zones).
 *
 * - **Fit** (cards + gaps ≤ width): full size, full gap, centered.
 * - **Overlap** (would overflow): the inter-card step shrinks toward
 *   {@link MIN_STEP_FRACTION} × cardWidth so the row stays within `width`.
 * - **Shrink** ({@link zoneFitScale}): once the step floor is reached the CARD
 *   shrinks instead of the step, down to the {@link MIN_CARD_WIDTH} legibility
 *   floor — so a crowded row keeps every card's centre painted rather than
 *   burying each card under its neighbour (ADR 0103, issue #2725).
 * - **Degenerate** (the legibility floor or a band-height `maxScale` held the
 *   scale up and the row still overflows): the gap tightens past the step
 *   floor. Fitting the zone always wins — nothing is ever placed off-board.
 *
 * Returns one {@link Placement} per card, left-to-right, horizontally centered.
 */
export function rowLayout(opts: RowOptions): Placement[] {
    const {
        count,
        width,
        centerY,
        cardWidth = CARD_WIDTH,
        gap = DEFAULT_GAP,
        maxScale,
        widths,
    } = opts;
    if (count <= 0) return [];

    // Per-item footprints (issue #977): a fanned stack is wider than one card.
    // When every entry is `cardWidth` this whole computation reduces ALGEBRAICALLY
    // to the pre-#977 uniform layout (the `step`/`scale` values are identical).
    const w = normalizeWidths(widths, count, cardWidth);
    const sumW = w.reduce((a, b) => a + b, 0);

    // Adaptive per-zone card size (ADR 0103, issue #2725): the zone picks the
    // largest scale at which every footprint still steps by MIN_STEP_FRACTION.
    const fitScale = zoneFitScale({
        zoneWidth: width,
        footprints: w,
        cardWidth,
    });
    // A band-height cap trumps the legibility floor — a clipped card is worse
    // than a small one.
    const scale =
        maxScale !== undefined ? Math.min(fitScale, maxScale) : fitScale;

    // On-screen inter-item gap, computed AT THE FINAL SCALE. The row's span
    // from the first footprint's left edge to the last footprint's right edge
    // is `scale·sumW + gap·(count−1)`; keep the resting gap while it fits,
    // otherwise take exactly the gap that fills the zone (negative — the cards
    // overlap). The step floor is NOT re-applied here: `zoneFitScale` already
    // chose a scale at which it holds, and when it could not (legibility floor,
    // or a `maxScale` cap), fitting the zone still wins over the floor so
    // nothing is ever placed off-board.
    //
    // Deriving the gap at the SCALED size is what makes the floor reach the
    // screen: computing it at full size and multiplying by `scale` (the
    // pre-#2725 shape) left a band-capped row overlapping as if its cards were
    // still full-size, however small they had actually been drawn.
    const onScreenGap =
        count > 1
            ? Math.min(gap * scale, (width - scale * sumW) / (count - 1))
            : gap * scale;

    // Centre the run of on-screen footprints; each card's box (always
    // `cardWidth·scale` wide) is centred on `x`, and its footprint's left edge
    // is `x − cardWidth·scale/2` — the extra fan width grows rightward from
    // there. So the box centre sits half a card-width right of the footprint
    // left edge, exactly as the uniform layout placed it.
    const scaledSpan = sumW * scale + onScreenGap * (count - 1);
    let leftEdge = (width - scaledSpan) / 2;
    const halfBox = (cardWidth * scale) / 2;

    return Array.from({ length: count }, (_, i) => {
        const x = leftEdge + halfBox;
        leftEdge += w[i] * scale + onScreenGap;
        return { x, y: centerY, rotation: 0, scale };
    });
}

/**
 * Two packed blocks on one row, justified to opposite edges: the `left` cards
 * cluster flush-left, the `right` cards cluster flush-right, with the empty gap
 * between them (the back battlefield row — lands left, other noncreatures right).
 * Both blocks share one scale (capped by `maxScale` for band-height fit). If the
 * two blocks would collide (too many cards for the width), it falls back to a
 * single centered, packed {@link rowLayout} so nothing is clipped. When either
 * block is empty the present block is simply centered.
 *
 * Returns `left` placements first, then `right` — order the items the same way.
 */
export function splitRowLayout(opts: {
    left: number;
    right: number;
    width: number;
    centerY: number;
    cardWidth?: number;
    gap?: number;
    maxScale?: number;
    /** Per-item footprints for the left block (issue #977); missing/omitted
     *  entries default to `cardWidth`. See {@link RowOptions.widths}. */
    leftWidths?: number[];
    /** Per-item footprints for the right block (issue #977). */
    rightWidths?: number[];
}): Placement[] {
    const {
        left,
        right,
        width,
        centerY,
        cardWidth = CARD_WIDTH,
        gap = DEFAULT_GAP,
        maxScale,
        leftWidths,
        rightWidths,
    } = opts;
    const total = left + right;
    if (total <= 0) return [];
    const lw = normalizeWidths(leftWidths, left, cardWidth);
    const rw = normalizeWidths(rightWidths, right, cardWidth);
    // One block (or a single card) → just center it.
    if (left === 0 || right === 0) {
        return rowLayout({
            count: total,
            width,
            centerY,
            cardWidth,
            maxScale,
            widths: left === 0 ? rw : lw,
        });
    }

    // Same adaptive per-zone rule as the centered row (ADR 0103, issue #2725):
    // both blocks share one scale, chosen so every footprint still steps by
    // MIN_STEP_FRACTION. If the two blocks then collide the fallback below
    // re-lays the whole run as one centered `rowLayout`, which is the branch
    // that owns the degenerate case.
    const fitScale = zoneFitScale({
        zoneWidth: width,
        footprints: [...lw, ...rw],
        cardWidth,
    });
    const scale =
        maxScale !== undefined ? Math.min(fitScale, maxScale) : fitScale;

    const half = (cardWidth * scale) / 2;
    // Left block packs flush-left: each item's footprint left edge follows the
    // previous item's footprint (+ gap); the box centre is half a card-width
    // right of that edge. Right block packs flush-right the same way, built from
    // the right boundary inward so the rightmost footprint ends at `width`.
    const leftPlacements: Placement[] = [];
    let edge = 0;
    for (let i = 0; i < left; i++) {
        leftPlacements.push({ x: edge + half, y: centerY, rotation: 0, scale });
        edge += lw[i] * scale + gap;
    }
    const rightEdgeOfLeftBlock = edge - gap;

    const rightPlacements: Placement[] = new Array(right);
    let rEdge = width; // right edge of the current (rightmost-first) footprint
    for (let j = right - 1; j >= 0; j--) {
        const leftOfFootprint = rEdge - rw[j] * scale;
        rightPlacements[j] = {
            x: leftOfFootprint + half,
            y: centerY,
            rotation: 0,
            scale,
        };
        rEdge = leftOfFootprint - gap;
    }
    const leftEdgeOfRightBlock = rEdge + gap;

    // Blocks collide → fall back to a single centered packed row that reserves
    // every item's footprint (order: left block then right block).
    if (rightEdgeOfLeftBlock + gap > leftEdgeOfRightBlock) {
        return rowLayout({
            count: total,
            width,
            centerY,
            cardWidth,
            maxScale,
            widths: [...lw, ...rw],
        });
    }

    return [...leftPlacements, ...rightPlacements];
}

/** A single band (row) for {@link bandedRowsLayout}, vertically centered at
 *  `centerYFrac` (0..1) of the zone height. A band is EITHER a simple centered
 *  row of `count` cards, OR a two-block `split` row (left/right justified to
 *  opposite edges — the lands-left / noncreatures-right back row). */
export type LayoutBand = {
    /** Row center as a fraction of zone height (0 = top edge, 1 = bottom edge). */
    centerYFrac: number;
    /** Simple centered row of this many cards. Mutually exclusive with `split`. */
    count?: number;
    /** Two-block row: `left` cards flush-left, `right` cards flush-right. */
    split?: { left: number; right: number };
    /** Per-item footprints for a `count` band (issue #977). Length = `count`;
     *  missing entries default to `cardWidth`. See {@link RowOptions.widths}. */
    widths?: number[];
    /** Per-item footprints for a `split` band's left / right blocks (issue #977). */
    leftWidths?: number[];
    rightWidths?: number[];
};

/** Vertical padding (px) kept above+below each band's cards so adjacent rows
 *  don't touch. The default suits a desktop-height board; a very short board
 *  (landscape-compact, #1768) overrides it via `bandedRowsLayout`'s `bandPad`,
 *  where a fixed 14px would be a fifth of the whole row and would be spent
 *  shrinking cards rather than separating them. */
export const BAND_V_PAD = 14;

/** Width of the right control column (#334) — the collapsed controller pod plus
 *  its edge offset. The board reserves a matching right gutter on BOTH seats so
 *  the back row's flush-right noncreature block always ends before this column
 *  and no permanent is ever hidden under the pod. The opponent reserves the same
 *  gutter for symmetry even though it hosts no pod, so the right edge reads as
 *  one symmetric column (opponent piles · stack · pod · viewer piles).
 *
 *  Sized to the pod's footprint: `w-52` (208px) + `right-4` (16px) offset. Kept
 *  here next to the layout math so the gutter and the pod can't drift apart. */
export const RIGHT_GUTTER = 224;

/** Portrait hand (#336): at or below this many cards the flat-overlap hand lays
 *  out within the viewport; beyond it the hand scrolls horizontally so cards
 *  stay legible instead of cramming into ever-thinner slivers. */
export const PORTRAIT_HAND_SCROLL_THRESHOLD = 6;

/** Whether the portrait hand should scroll horizontally for a given card count
 *  (#336). True strictly above {@link PORTRAIT_HAND_SCROLL_THRESHOLD}. */
export function portraitHandScrolls(count: number): boolean {
    return count > PORTRAIT_HAND_SCROLL_THRESHOLD;
}

/**
 * Stacks several rows inside ONE full-height zone — the battlefield split into a
 * creature row and a lands+noncreature back row (Arena-style) without clipping.
 * Every band shares the SAME zone height, so each row's cards are capped to a
 * band-height-derived `maxScale` and never overflow their slice the way short
 * `overflow-hidden` sub-zones would. A `count` band is a centered
 * {@link rowLayout}; a `split` band is a {@link splitRowLayout}. Placements are
 * returned concatenated in band order (and, within a split band, left then
 * right), so the caller orders its items the same way.
 */
export function bandedRowsLayout(opts: {
    bands: LayoutBand[];
    width: number;
    height: number;
    cardWidth?: number;
    cardHeight?: number;
    /** Pixels reserved on the RIGHT for the control column (#334). When set, the
     *  usable width shrinks by this amount so the flush-right back-row block ends
     *  before the column (`usableWidth = width - rightGutter`) and nothing is
     *  hidden under the pod. Applied identically on both seats for symmetry —
     *  the opponent reserves it even though it hosts no pod. Defaults to 0. */
    rightGutter?: number;
    /** Vertical padding kept inside each band's height slice before capping the
     *  card scale. Defaults to {@link BAND_V_PAD}; landscape-compact (#1768)
     *  passes a tighter value because on a ~140px band the desktop padding
     *  costs more card than it buys separation. */
    bandPad?: number;
}): Placement[] {
    const {
        bands,
        width,
        height,
        cardWidth = CARD_WIDTH,
        cardHeight = CARD_HEIGHT,
        rightGutter = 0,
        bandPad = BAND_V_PAD,
    } = opts;
    if (bands.length === 0 || height <= 0) return [];
    // Reserve the right control column: every band is placed within
    // `[0, usableWidth]`, so the flush-right block stops before the column.
    // Clamp so a degenerate (very narrow) board never goes negative.
    const usableWidth = Math.max(cardWidth, width - rightGutter);
    // Each band may use at most its even share of the height; cap the card scale
    // so a full-height card fits that slice (minus padding).
    const bandHeight = height / bands.length;
    const maxScale = Math.max(
        0.1,
        Math.min(1, (bandHeight - bandPad) / cardHeight)
    );
    return bands.flatMap((band) => {
        const centerY = height * band.centerYFrac;
        if (band.split) {
            return splitRowLayout({
                left: band.split.left,
                right: band.split.right,
                width: usableWidth,
                centerY,
                cardWidth,
                maxScale,
                leftWidths: band.leftWidths,
                rightWidths: band.rightWidths,
            });
        }
        return rowLayout({
            count: band.count ?? 0,
            width: usableWidth,
            centerY,
            cardWidth,
            maxScale,
            widths: band.widths,
        });
    });
}

type FanOptions = {
    /** Number of cards in the hand. */
    count: number;
    /** Available container width in pixels. */
    width: number;
    /** Vertical baseline for the fan, in container pixels. */
    baseY: number;
    /** Base card width (defaults to {@link CARD_WIDTH}). */
    cardWidth?: number;
    /** Base card height (defaults to {@link CARD_HEIGHT}). */
    cardHeight?: number;
};

/** Total angular spread of the fan across all cards, in degrees. */
const FAN_SPREAD_DEG = 44;
/** Max rotation per card so small hands don't over-rotate. */
const FAN_MAX_DEG_PER_CARD = 7;
/** Inter-card step as a fraction of card width in the fan. Equal to
 *  {@link MIN_STEP_FRACTION} — the hand's designed reveal is what the whole
 *  board's step floor was set to (issue #2725), so a hand at rest steps by
 *  exactly the floor and only ever shrinks, never tightens, to fit. */
const FAN_STEP_FRACTION = MIN_STEP_FRACTION;
/** Edge lift as a fraction of card height per card-step from center. */
const FAN_LIFT_FRACTION = 0.07;

/**
 * Shallow fanned arc layout (the hand). Cards rotate symmetrically toward the
 * edges (left edge tilts left/negative, right edge tilts right/positive),
 * centered, with a gentle dome lift so the arc reads as physical. The center
 * card sits flat (0°) on odd counts; even counts straddle 0° symmetrically.
 *
 * Returns one {@link Placement} per card, left-to-right.
 */
export function fanLayout(opts: FanOptions): Placement[] {
    const {
        count,
        width,
        baseY,
        cardWidth = CARD_WIDTH,
        cardHeight = CARD_HEIGHT,
    } = opts;
    if (count <= 0) return [];

    const degPerCard =
        count > 1
            ? Math.min(FAN_SPREAD_DEG / (count - 1), FAN_MAX_DEG_PER_CARD)
            : 0;

    // Adaptive per-zone card size (ADR 0103, issue #2725). The hand SHRINKS to
    // fit rather than fanning ever tighter: before this, `step` was clamped only
    // by `fitStep`, so a big hand in a narrow band stacked its cards past their
    // own centres — the measured reason the `game-board` ui-gate surface could
    // not be budgeted (`cardsOcc` 4 then 5 on two runs of the same tree, "hand-
    // fan overlap scales with the hand", `scripts/ui-gate/budgets.json`).
    const scale = zoneFitScale({
        zoneWidth: width,
        footprints: Array.from({ length: count }, () => cardWidth),
        cardWidth,
    });
    const scaledCardWidth = cardWidth * scale;

    // Step shrinks to stay on-screen, just like the row layout. At the resting
    // fan this is exactly the step floor; `fitStep` only binds in the degenerate
    // case where `scale` bottomed out on the legibility floor.
    const idealStep = scaledCardWidth * FAN_STEP_FRACTION;
    const fitStep = count > 1 ? (width - scaledCardWidth) / (count - 1) : 0;
    const step = count > 1 ? Math.min(idealStep, fitStep) : 0;

    const totalWidth = scaledCardWidth + step * (count - 1);
    const startX = (width - totalWidth) / 2 + scaledCardWidth / 2;
    const mid = (count - 1) / 2;

    return Array.from({ length: count }, (_, i) => {
        const offsetFromCenter = i - mid;
        const rotation = offsetFromCenter * degPerCard;
        const lift =
            Math.abs(offsetFromCenter) *
            (cardHeight * scale * FAN_LIFT_FRACTION);
        return {
            x: startX + step * i,
            y: baseY + lift,
            rotation,
            scale,
        };
    });
}

/**
 * Drag-reorder slot resolution for the hand (PRD #249, issue #271, fix 2).
 *
 * Given the fan placements (their center `x` positions are the slot anchors),
 * the index of the card currently being dragged, and the pointer's `x` while
 * dragging, returns the index the dragged card should snap INTO. View-only
 * presentation reorder — it never touches the GRE/zone (the hand order on the
 * server is unchanged); it only reshuffles how the viewer's own hand is laid
 * out so dragging a card sideways slides it past its neighbours, Arena-style.
 *
 * The result is the destination index in the CURRENT array's frame: moving the
 * card from `fromIndex` to the returned `toIndex` (via {@link moveItem}) yields
 * the reordered hand. Snaps to the slot whose center is nearest the pointer, so
 * the dragged card settles under the drop position.
 */
export function reorderIndexForDragX(
    placements: Placement[],
    fromIndex: number,
    pointerX: number
): number {
    const count = placements.length;
    if (count <= 1) return fromIndex;
    if (fromIndex < 0 || fromIndex >= count) return fromIndex;

    // Snap to the slot whose center x is closest to the pointer. Slot centers
    // are monotonic left-to-right, so the nearest center is the slot the card
    // is hovering over — that becomes its new index.
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < count; i++) {
        const dist = Math.abs(placements[i].x - pointerX);
        if (dist < nearestDist) {
            nearestDist = dist;
            nearest = i;
        }
    }
    return nearest;
}

/**
 * Clamp the dragged hand card's horizontal lift so its rendered center never
 * travels past the first or last slot center (issue: a card dragged sideways
 * could be flung out of the viewport). The card follows the pointer freely
 * within the hand span but is pinned at the ends — it can never go beyond the
 * first or last card of the hand.
 *
 * `placements` are the slot centers in the CURRENT presentation order,
 * `fromIndex` is the dragged card's slot, and `rawDx` is the pointer's raw
 * horizontal offset from the press origin (the un-clamped visual lift). The
 * card's rendered center is `slotCenter + dx`, so bounding that center to
 * `[minCenter, maxCenter]` yields the clamped `dx`. Reorder (which snaps the
 * card under the pointer) is unaffected — this only bounds the visual lift.
 */
export function clampDragOffsetX(
    placements: Placement[],
    fromIndex: number,
    rawDx: number
): number {
    const count = placements.length;
    if (count === 0 || fromIndex < 0 || fromIndex >= count) return rawDx;
    const self = placements[fromIndex].x;
    let min = placements[0].x;
    let max = placements[0].x;
    for (const p of placements) {
        if (p.x < min) min = p.x;
        if (p.x > max) max = p.x;
    }
    // Bound rendered center (self + dx) to [min, max].
    return Math.min(max - self, Math.max(min - self, rawDx));
}

/**
 * Open a GAP in the fan for a card being dragged, WITHOUT committing a reorder
 * (PRD #249, drag-reorder v2). Returns one placement per card in the CURRENT
 * (unchanged) order: the dragged card (`from`) is parked on the fan slot under
 * the drop target (`dropIndex`) — its own pointer-lift then floats it to the
 * cursor — while every other card fills the remaining slots in order, so the
 * cards between the source and the target slide over to reveal an empty landing
 * slot exactly where the card will drop.
 *
 * Crucially the ITEM ARRAY never changes during the drag (only these placements
 * do): the dragged card's DOM node stays put, so its pointer capture is never
 * dropped mid-gesture (a live array reorder moved the node and silently killed
 * the drag after a single slot). The real reorder is applied once, on release,
 * via {@link moveItem}(order, from, dropIndex) — and because this gap layout
 * already matches the post-commit fan exactly, the commit is seamless (no jump).
 *
 * Pure: `fan` are the resting fan placements (from {@link fanLayout}); returns a
 * new array. Out-of-range indices return a shallow copy unchanged.
 */
export function handGapPlacements(
    fan: Placement[],
    from: number,
    dropIndex: number
): Placement[] {
    const n = fan.length;
    if (from < 0 || from >= n || dropIndex < 0 || dropIndex >= n) {
        return fan.slice();
    }
    const res: Placement[] = new Array(n);
    // Dragged card parks on the drop-target slot (its lift floats it to cursor).
    res[from] = fan[dropIndex];
    // Every OTHER card fills the remaining slots (all except the drop slot) in
    // ascending slot order, so the run between source and target shifts by one to
    // open the gap.
    const avail: Placement[] = [];
    for (let s = 0; s < n; s++) {
        if (s !== dropIndex) avail.push(fan[s]);
    }
    let k = 0;
    for (let i = 0; i < n; i++) {
        if (i === from) continue;
        res[i] = avail[k++];
    }
    return res;
}

/** Move the item at `from` to index `to`, returning a new array. Out-of-range
 *  or no-op moves return a shallow copy unchanged. Pure — used to apply a
 *  {@link reorderIndexForDragX} result to the presentation hand order. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
    const next = items.slice();
    if (
        from < 0 ||
        from >= next.length ||
        to < 0 ||
        to >= next.length ||
        from === to
    ) {
        return next;
    }
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

/**
 * Reconcile a view-only hand permutation against the authoritative server hand
 * (PRD #249, issue #271 fix 2).
 *
 * `viewOrder` is the presentation order the player produced by drag-reordering;
 * `serverIds` is the current authoritative hand. Returns the order to actually
 * render: the view-only permutation is honoured for ids that still exist, ids
 * removed on the server (played / discarded) are dropped, and ids the server
 * added (drawn) are appended in server order. This keeps a pure sideways drag
 * stable while a real hand change folds in without resetting the whole hand — so
 * existing card slots keep their identity (and their spring FLIP) rather than
 * remounting.
 */
export function reconcileHandOrder(
    viewOrder: string[],
    serverIds: string[]
): string[] {
    const serverSet = new Set(serverIds);
    // Honour the view-only order for ids the server still has.
    const kept = viewOrder.filter((id) => serverSet.has(id));
    const keptSet = new Set(kept);
    // Append any server ids not already placed (newly drawn), in server order.
    const added = serverIds.filter((id) => !keptSet.has(id));
    return [...kept, ...added];
}

/** Mirror a placement vertically within a container of height `containerHeight`
 *  — used to project a viewer-side layout onto the opponent's (top) side so the
 *  same math drives both. Rotation is negated so the fan dome flips too. */
export function mirrorVertical(
    placement: Placement,
    containerHeight: number
): Placement {
    return {
        x: placement.x,
        y: containerHeight - placement.y,
        rotation: -placement.rotation,
        scale: placement.scale,
    };
}
