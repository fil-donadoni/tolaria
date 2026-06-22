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
};

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
    } = opts;
    if (count <= 0) return [];

    const idealStep = cardWidth + gap;
    const minStep = cardWidth * MIN_STEP_FRACTION;

    // Largest step that still fits `count` cards within `width` (the last
    // card's far edge must not cross the right boundary).
    const fitStep = count > 1 ? (width - cardWidth) / (count - 1) : 0;

    // Keep full gap while it fits; otherwise shrink the step down to the
    // overlap floor (`minStep`). The step never exceeds the ideal.
    let step = Math.min(idealStep, Math.max(fitStep, minStep));

    // If even the overlap floor overflows the zone, shrink scale to fit —
    // clamped at the floor so cards never become unreadably small.
    const naturalWidth = cardWidth + minStep * (count - 1);
    const fitScale =
        naturalWidth > width ? Math.max(MIN_SCALE, width / naturalWidth) : 1;
    // A band-height cap trumps the readability floor — a clipped card is worse
    // than a small one.
    const scale =
        maxScale !== undefined ? Math.min(fitScale, maxScale) : fitScale;

    // After clamping scale, the scaled overlap row may still overflow at truly
    // extreme counts. In that regime tighten the step below the overlap floor
    // so the placed (scaled) row always fits the zone — nothing is clipped.
    if (count > 1) {
        const maxScaledStep = (width - cardWidth * scale) / (count - 1);
        const maxStep = maxScaledStep / scale;
        if (step > maxStep) step = Math.max(0, maxStep);
    }

    const totalWidth = (cardWidth + step * (count - 1)) * scale;
    const startX = (width - totalWidth) / 2 + (cardWidth * scale) / 2;
    const scaledStep = step * scale;

    return Array.from({ length: count }, (_, i) => ({
        x: startX + scaledStep * i,
        y: centerY,
        rotation: 0,
        scale,
    }));
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
}): Placement[] {
    const {
        left,
        right,
        width,
        centerY,
        cardWidth = CARD_WIDTH,
        gap = DEFAULT_GAP,
        maxScale,
    } = opts;
    const total = left + right;
    if (total <= 0) return [];
    // One block (or a single card) → just center it.
    if (left === 0 || right === 0) {
        return rowLayout({ count: total, width, centerY, cardWidth, maxScale });
    }

    const minStep = cardWidth * MIN_STEP_FRACTION;
    const naturalWidth = cardWidth + minStep * (total - 1);
    const fitScale =
        naturalWidth > width ? Math.max(MIN_SCALE, width / naturalWidth) : 1;
    const scale =
        maxScale !== undefined ? Math.min(fitScale, maxScale) : fitScale;

    const half = (cardWidth * scale) / 2;
    const step = cardWidth * scale + gap;
    const leftEdgeOfRightBlock = width - half - (right - 1) * step - half;
    const rightEdgeOfLeftBlock = half + (left - 1) * step + half;
    // Blocks collide → fall back to a single centered packed row.
    if (rightEdgeOfLeftBlock + gap > leftEdgeOfRightBlock) {
        return rowLayout({ count: total, width, centerY, cardWidth, maxScale });
    }

    const placements: Placement[] = [];
    for (let i = 0; i < left; i++) {
        placements.push({
            x: half + i * step,
            y: centerY,
            rotation: 0,
            scale,
        });
    }
    for (let j = 0; j < right; j++) {
        const fromRight = right - 1 - j;
        placements.push({
            x: width - half - fromRight * step,
            y: centerY,
            rotation: 0,
            scale,
        });
    }
    return placements;
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
};

/** Vertical padding (px) kept above+below each band's cards so adjacent rows
 *  don't touch. */
const BAND_V_PAD = 14;

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
}): Placement[] {
    const {
        bands,
        width,
        height,
        cardWidth = CARD_WIDTH,
        cardHeight = CARD_HEIGHT,
        rightGutter = 0,
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
        Math.min(1, (bandHeight - BAND_V_PAD) / cardHeight)
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
            });
        }
        return rowLayout({
            count: band.count ?? 0,
            width: usableWidth,
            centerY,
            cardWidth,
            maxScale,
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
