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
 * Auto-sizing rule (validated by the prototype): cards keep full size and a
 * fixed gap until they would overflow the zone width; past that the inter-card
 * step shrinks (cards overlap); only at extreme counts does `scale` shrink.
 * Nothing is ever placed off the board.
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

/** The horizontal footprint (px) a TAPPED permanent occupies on the
 *  battlefield row (issue #1994). Rotating a 5:7 portrait card 90° swaps its
 *  bounding box to a 7:5 landscape rectangle, so its rendered — and
 *  hit-tested, CSS transforms affect hit-testing too — width becomes the
 *  card's own HEIGHT, not its width. Same formula as {@link CARD_HEIGHT} so
 *  the two can never drift apart when `cardWidth` changes (landscape-compact
 *  passes a smaller one): `tappedFootprintWidth(CARD_WIDTH) === CARD_HEIGHT`.
 *
 *  The row layout ({@link rowLayout} / {@link splitRowLayout}) reserves this
 *  as the tapped item's `widths[]` entry — the SAME mechanism
 *  {@link stackFootprintWidth} uses for a fanned stack (issue #977), reused
 *  here rather than reinvented. An earlier version of this fix instead
 *  post-rotate-scaled the card by its own aspect ratio (5/7) to shrink the
 *  rotated box back down to the UNROTATED slot width — that restored the
 *  footprint, but at the cost of rendering every tapped permanent 29% smaller
 *  linear (51% area) on EVERY viewport, including desktop (where the
 *  occlusion this issue fixes never occurs) and every attacking creature in
 *  combat (attackers are tapped) — an undisclosed global visual regression.
 *  Reserving the wider footprint in the layout instead keeps the card at full
 *  size, exactly as a tapped permanent looks on a physical table; the
 *  accepted cost is that tapping a permanent reflows its row. */
export function tappedFootprintWidth(cardWidth: number = CARD_WIDTH): number {
    return Math.round((cardWidth * 7) / 5);
}

/** Default gap between full-size cards before any overlap kicks in. */
const DEFAULT_GAP = 12;

/** Tightest inter-card step as a fraction of card width once cards overlap.
 *  At this overlap a card still reveals ~32% of its neighbour. */
const MIN_STEP_FRACTION = 0.32;

/** Floor on `scale` — even an extreme count never shrinks past this. */
const MIN_SCALE = 0.7;

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

/** Overlap floor as an effective inter-item gap: at the tightest overlap a
 *  uniform card still reveals {@link MIN_STEP_FRACTION} of its width, i.e. the
 *  gap goes to `(MIN_STEP_FRACTION − 1)·cardWidth` (negative — the cards
 *  overlap). Shared by {@link rowLayout} / {@link splitRowLayout}. */
function gapFloor(cardWidth: number): number {
    return (MIN_STEP_FRACTION - 1) * cardWidth;
}

/**
 * Auto-sizing row layout (battlefield zones).
 *
 * - **Fit** (cards + gaps ≤ width): full size, full gap, centered.
 * - **Overlap** (would overflow): the inter-card step shrinks toward
 *   {@link MIN_STEP_FRACTION} × cardWidth so the row stays within `width`.
 * - **Scale** (extreme counts): only when even the tightest overlap can't fit
 *   does `scale` drop (clamped at {@link MIN_SCALE}), keeping every card on the
 *   board.
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
    const gapEffFloor = gapFloor(cardWidth);

    // The whole row's span from the first footprint's left edge to the last
    // footprint's right edge is `sumW + gapEff·(count−1)` for a shared
    // inter-item gap `gapEff`. Keep the full gap while it fits; otherwise shrink
    // it toward the overlap floor (may go negative — the cards overlap).
    const fitGapEff = count > 1 ? (width - sumW) / (count - 1) : gap;
    const gapEff = Math.min(gap, Math.max(fitGapEff, gapEffFloor));

    // If even the overlap floor overflows the zone, shrink scale to fit —
    // clamped at the readability floor so cards never become unreadably small.
    const floorSpan = sumW + gapEffFloor * (count - 1);
    const fitScale =
        floorSpan > width ? Math.max(MIN_SCALE, width / floorSpan) : 1;
    // A band-height cap trumps the readability floor — a clipped card is worse
    // than a small one.
    const scale =
        maxScale !== undefined ? Math.min(fitScale, maxScale) : fitScale;

    // On-screen inter-item gap. After clamping scale, the scaled overlap row may
    // still overflow at truly extreme counts; tighten the gap (below the floor,
    // even negative) so the placed row always fits — nothing is clipped.
    let onScreenGap = gapEff * scale;
    if (count > 1) {
        const maxGap = (width - scale * sumW) / (count - 1);
        if (onScreenGap > maxGap) onScreenGap = maxGap;
    }

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

    const gapEffFloor = gapFloor(cardWidth);
    const sumW = [...lw, ...rw].reduce((a, b) => a + b, 0);
    const floorSpan = sumW + gapEffFloor * (total - 1);
    const fitScale =
        floorSpan > width ? Math.max(MIN_SCALE, width / floorSpan) : 1;
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
/** Inter-card step as a fraction of card width in the fan. */
const FAN_STEP_FRACTION = 0.62;
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

    // Step shrinks to stay on-screen, just like the row layout.
    const idealStep = cardWidth * FAN_STEP_FRACTION;
    const fitStep = count > 1 ? (width - cardWidth) / (count - 1) : 0;
    const step = count > 1 ? Math.min(idealStep, fitStep) : 0;

    const totalWidth = cardWidth + step * (count - 1);
    const startX = (width - totalWidth) / 2 + cardWidth / 2;
    const mid = (count - 1) / 2;

    return Array.from({ length: count }, (_, i) => {
        const offsetFromCenter = i - mid;
        const rotation = offsetFromCenter * degPerCard;
        const lift =
            Math.abs(offsetFromCenter) * (cardHeight * FAN_LIFT_FRACTION);
        return {
            x: startX + step * i,
            y: baseY + lift,
            rotation,
            scale: 1,
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
