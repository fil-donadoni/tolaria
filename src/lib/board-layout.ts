/**
 * Shared, pure layout math for the new spatial board (`BoardNext`, PRD #249,
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
    const scale =
        naturalWidth > width ? Math.max(MIN_SCALE, width / naturalWidth) : 1;

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
const FAN_LIFT_FRACTION = 0.04;

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
