/** The last-seconds Auto-Pick cue (issue #9165): in the final
 *  `AUTOPICK_CUE_SECONDS` of a Pick, the card the clock will take is marked,
 *  whatever the "Show autopick" toggle says. */
export const AUTOPICK_CUE_SECONDS = 5;

/** The card an expiry will take, in the server's order
 *  (`resolveAutoPickTimeout`): the Selected Card when it is still in the pack,
 *  else the Default Pick. `null` = the Bot chooses (nothing to mark). */
export function autopickTargetId({
    pack,
    selectedPickId,
    defaultPickId,
}: {
    pack: readonly { pickId: string }[];
    selectedPickId: string | null;
    defaultPickId: string | null;
}): string | null {
    for (const id of [selectedPickId, defaultPickId]) {
        if (id !== null && pack.some((c) => c.pickId === id)) return id;
    }
    return null;
}

/** Whole seconds left (ceil, as the Pick Timer reads) when inside the cue
 *  window, else `null`. */
export function autopickCueSeconds(
    pickDeadline: number | null,
    now: number
): number | null {
    if (pickDeadline === null) return null;
    const seconds = Math.ceil(Math.max(0, pickDeadline - now) / 1000);
    return seconds <= AUTOPICK_CUE_SECONDS ? seconds : null;
}
