/**
 * The Draft Room's PHONE SNAP MODEL (issue #2588, PRD #2405 slice 9, ADR
 * 0101 §6) — the arithmetic behind "exactly two scroll positions", kept pure
 * so it is unit-testable without a layout engine (happy-dom measures
 * everything as zero, which is the whole reason this is not inlined in the
 * pane components).
 *
 * The shape, in one paragraph. The two panes live in ONE scroller with
 * `scroll-snap-type: mandatory`. Each pane is a FRACTION of the scroller —
 * 85% in portrait, 80% in landscape — so the other pane always shows through
 * as a strip, and that strip is the live tab AND the drop target for the card
 * in hand. Pane 1 is `snap-start`, pane 2 is `snap-end`, which makes the two
 * reachable offsets exactly `0` and `maxOffset` (the scroller's own
 * `scrollHeight - clientHeight` / `scrollWidth - clientWidth`) and nothing in
 * between.
 *
 * `maxOffset` is not the pane size: two panes of 0.85 make content of 1.7
 * viewports, so the bottom stop lands at 0.7, not 0.85. Deriving the stop
 * from the element's own max rather than from the fraction is what keeps the
 * two ends honest at any rounding.
 */

/** Which pane the scroller has settled on. */
export type DraftSnapStop = "pack" | "pool";

/** The two phone arrangements. NOT `ViewportMode` — this module knows nothing
 *  about media queries; `LimitedDraftTable` resolves the regime and names it. */
export type DraftPhoneOrientation = "portrait" | "landscape";

/** Each pane's size as a fraction of the scroller (ADR 0101 §6: portrait
 *  Pack 85 / Pool 15, landscape pack 80 | 20% sneak-peek column). */
export const DRAFT_PANE_FRACTION: Record<DraftPhoneOrientation, number> = {
    portrait: 0.85,
    landscape: 0.8,
};

/** The strip as a fraction of the PANE it belongs to — what a pane's own
 *  status bar / tab row is sized with. A 15% strip of the viewport is
 *  15/85 = 17.6% of an 85% pane, and a component that wrote `15%` inside the
 *  pane would draw the wrong band. */
export function draftStripFraction(orientation: DraftPhoneOrientation): number {
    const pane = DRAFT_PANE_FRACTION[orientation];
    return (1 - pane) / pane;
}

/** How far past the pack stop already counts as "on the pool" WHILE A SWIPE
 *  IS IN FLIGHT. Deliberately early (a tenth of the travel, the prototype's
 *  bias): the strip is a LIVE tab, so it must flip to "tap: back to pack" as
 *  the pane leaves rather than at the halfway mark. Snap-mandatory guarantees
 *  the scroller ends on one of the two stops regardless of this number — it
 *  only decides what the tab says on the way. */
export const DRAFT_STOP_BIAS = 0.1;

/** The stop an offset reads as. `maxOffset <= 0` (an unlaid-out or unscrollable
 *  scroller — every scroller in happy-dom) is the pack: the pane the room
 *  opens on. */
export function draftStopAtOffset(
    offset: number,
    maxOffset: number
): DraftSnapStop {
    if (maxOffset <= 0) return "pack";
    return offset > maxOffset * DRAFT_STOP_BIAS ? "pool" : "pack";
}

/** The scroll offset of a stop. Exactly two values exist, `0` and the
 *  scroller's own maximum — the assertion the five-viewport probe makes. */
export function draftStopOffset(
    stop: DraftSnapStop,
    maxOffset: number
): number {
    return stop === "pool" ? Math.max(0, maxOffset) : 0;
}

/** Seconds left at which a player parked on the Pool is pulled back to the
 *  pack (ADR 0101 §6: "auto-snap only if the timer is on and <10s"). The same
 *  threshold the Pick Timer already calls urgent
 *  (`limited-draft-timer.tsx`) — one definition of "nearly out of time" would
 *  be better still, but that one is private to the bar's tone and this one is
 *  a navigation rule; they are re-derived from the same CR-free product
 *  decision, not from each other. */
export const DRAFT_AUTO_SNAP_SECONDS = 10;

/**
 * Whether the surface should pull itself back to the pack.
 *
 * Every clause is a REFUSAL, because yanking the view out from under a player
 * who is arranging their pool is the expensive failure mode here:
 *  - only while parked on the pool (on the pack there is nothing to do);
 *  - only with a pack actually in front of this seat;
 *  - only when the timer is ON — a timer-less event never steals the view;
 *  - only inside the last {@link DRAFT_AUTO_SNAP_SECONDS} seconds, and not
 *    after expiry (the server auto-picks then, and snapping to a pack that is
 *    about to be replaced is noise).
 */
export function shouldAutoSnapToPack(input: {
    stop: DraftSnapStop;
    hasPack: boolean;
    pickDeadline: number | null;
    now: number;
}): boolean {
    if (input.stop !== "pool" || !input.hasPack) return false;
    if (input.pickDeadline === null) return false;
    const remainingMs = input.pickDeadline - input.now;
    return remainingMs > 0 && remainingMs <= DRAFT_AUTO_SNAP_SECONDS * 1000;
}

/** Identity of the pack in front of the seat, so "a new pack arrived" is a
 *  value comparison and not a guess.
 *
 *  Neither half alone is enough. LENGTH alone cannot tell a fresh 15-card
 *  pack from the one before it in the next round. The FIRST `pickId` alone
 *  cannot tell a pack from the SAME pack coming back around the table with
 *  cards taken out of its middle (`r0-p0-c0` may still be at the front). The
 *  pair can: the same physical pack always returns SHORTER than it left, and
 *  two different packs never share a `pickId` namespace
 *  (`r<round>-p<pack>-c<n>`, minted per pack by the draft engine).
 *
 *  `null` = no pack in front of this seat (waiting for the pass). */
export function draftPackIdentity(
    pack: readonly { pickId: string }[]
): string | null {
    const first = pack[0];
    return first === undefined ? null : `${pack.length}:${first.pickId}`;
}
