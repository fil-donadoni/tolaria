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
// time, so no countdown is shown and no Auto-Pick timeout is ever scheduled
// for it (`draftEngine.ts`'s `assignFreshPack` skips stamping a deadline in
// this case — the player still submits the final pick manually, just with no
// visible countdown; there is no pre-existing "auto-resolve the very last
// card" mechanism to hook into, and building one is out of scope here).
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
