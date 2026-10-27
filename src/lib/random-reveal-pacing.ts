/** Client pacing table for the Random Reveal (CR 705.2, ADR 0023): the ONE
 *  place the reveal's timing lives. Animation timing is a CLIENT concern (the
 *  engine carries no wall-clock); the overlay and the vs-AI driver both read
 *  this table so the Bot's ack can never cut a viewer's animation short.
 *  Today it is the single flip; later slices of #4433 extend it to sequences
 *  (`tossMs(i)`, `holdMs(i)`, `sequenceDurationMs(n)`). */

/** Coin toss duration: the spin until the coin lands. */
export const FLIP_ANIM_MS = 1600;

/** Final hold: how long the landed face stays up after the toss before the
 *  reveal is acknowledged / closes. */
export const REVEAL_FINAL_HOLD_MS = 800;

/** Full duration of a single-flip reveal: toss, then the final hold. */
export function revealDurationMs(): number {
    return FLIP_ANIM_MS + REVEAL_FINAL_HOLD_MS;
}
