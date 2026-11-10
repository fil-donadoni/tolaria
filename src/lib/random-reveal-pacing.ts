/** Client pacing table for the Random Reveal (CR 705.2, ADR 0023): the ONE
 *  place the reveal's timing lives. Animation timing is a CLIENT concern (the
 *  engine carries no wall-clock); the overlay, the lingering viewer overlay and
 *  the vs-AI driver all read this table so the Bot's ack can never cut a
 *  viewer's animation short. A Flip Sequence of `n` rounds tosses each coin
 *  (`tossMs`), holds each result before the next toss (`holdMs`) and holds the
 *  last one (`REVEAL_FINAL_HOLD_MS`) before the reveal is acknowledged. Tune
 *  the pacing here and nowhere else (issue #5519). */

/** The first toss: the spin until the coin lands. */
export const FLIP_ANIM_MS = 1600;

/** Tosses never get shorter than this. */
const MIN_PHASE_MS = 650;

/** Final hold: how long the last landed result stays up after its toss before
 *  the reveal is acknowledged / closes. */
export const REVEAL_FINAL_HOLD_MS = 1400;

/** Toss duration of round `round` (0-based): each later toss is 30% shorter. */
export function tossMs(round: number): number {
    return Math.max(MIN_PHASE_MS, Math.round(FLIP_ANIM_MS * 0.7 ** round));
}

/** How long round `round`'s result is held before the next toss starts. */
export function holdMs(round: number): number {
    return Math.max(MIN_PHASE_MS, 1100 - 120 * round);
}

/** Full duration of a reveal of `rounds` tosses: every toss, the hold between
 *  tosses, then the final hold. */
export function sequenceDurationMs(rounds: number): number {
    let total = REVEAL_FINAL_HOLD_MS;
    for (let i = 0; i < rounds; i += 1) {
        total += tossMs(i);
        if (i < rounds - 1) total += holdMs(i);
    }
    return total;
}
