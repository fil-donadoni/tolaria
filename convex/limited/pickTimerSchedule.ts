// Official MTGO/Wizards descending pick-timer schedule (ADR 0060, issue
// #1243): the per-pick countdown length as a PURE function of CARDS
// REMAINING in the pack the seat is about to pick from — never the round
// number, an absolute pick count, or the pack's original size. That's what
// lets a smaller-than-15-card pack (ARN/ATQ Booster = 8 cards) reuse the
// exact same table with no separate schedule or scaling: its very first pick
// simply starts at "8 cards remaining" instead of "15", so the countdown is
// shorter from the first pick onward, matching the official rule (CR: N/A —
// a house/tournament convention, not a Comprehensive Rules-governed timing).
//
// `null` means "auto": with 1 card remaining there is no real choice left to
// time, so NO COUNTDOWN IS SHOWN for it. That is a DISPLAY claim and nothing
// more (issue #2278). It used to also mean "and no Auto-Pick timeout is ever
// scheduled", which stranded the whole table whenever an absent Seat was
// passed the last card of a pack — the very thing the Pick Timer exists to
// prevent. The two meanings are now separate functions:
// `pickTimerSecondsForCardsRemaining` answers "how long a countdown do we
// RENDER" (`null` = none), `autoPickTimeoutSecondsForCardsRemaining` answers
// "how long before we Auto-Pick for an absent Seat" (`null` only at 0 cards,
// where there is nothing to pick).
const PICK_TIMER_SCHEDULE: ReadonlyMap<number, number> = new Map([
    [15, 40],
    [14, 40],
    [13, 35],
    [12, 30],
    [11, 25],
    [10, 25],
    [9, 20],
    [8, 20],
    [7, 15],
    [6, 10],
    [5, 10],
    [4, 5],
    [3, 5],
    [2, 5],
]);

/** Largest key the schedule table defines — a pack bigger than a standard
 *  15-card Booster (shouldn't happen for any checked-in set) still clamps to
 *  the top of the schedule rather than falling through to "no timer". */
const MAX_SCHEDULED_CARDS_REMAINING = 15;

/** Looks up the per-pick countdown, in seconds, for `cardsRemaining` cards
 *  left in the pack a seat is about to pick from. Returns `null` for the
 *  "auto" case (1 or fewer cards remaining — no real choice to time). */
export function pickTimerSecondsForCardsRemaining(
    cardsRemaining: number
): number | null {
    if (cardsRemaining <= 1) return null;
    const clamped = Math.min(cardsRemaining, MAX_SCHEDULED_CARDS_REMAINING);
    return PICK_TIMER_SCHEDULE.get(clamped) ?? null;
}

/** The schedule's floor — the countdown length already given to 2/3/4 cards
 *  remaining, reused as the Auto-Pick timeout for a 1-card pack (issue
 *  #2278). Short because there is nothing to deliberate over; the Seat who IS
 *  present sees the card and clicks it exactly as before, and its manual pick
 *  cancels the pending timeout through the usual `pickSeq` bump. */
export const AUTO_PICK_FLOOR_SECONDS = 5;

/** How long before an absent Seat's pack is Auto-Picked for it, in seconds —
 *  the SCHEDULING half of what `pickTimerSecondsForCardsRemaining`'s `null`
 *  used to conflate (issue #2278). Identical to the displayed countdown for
 *  every pack of 2+ cards; `AUTO_PICK_FLOOR_SECONDS` at exactly 1 card, where
 *  no countdown is rendered but the table must still be able to advance
 *  without the human. `null` only at 0 cards remaining — the defensive case
 *  has nothing to pick, so nothing is scheduled. */
export function autoPickTimeoutSecondsForCardsRemaining(
    cardsRemaining: number
): number | null {
    if (cardsRemaining <= 0) return null;
    if (cardsRemaining === 1) return AUTO_PICK_FLOOR_SECONDS;
    return pickTimerSecondsForCardsRemaining(cardsRemaining);
}
