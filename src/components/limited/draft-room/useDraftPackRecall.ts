import { useEffect, useRef, useState } from "react";
import { shouldAutoSnapToPack, type DraftSnapStop } from "./draftSnapStops";

/** How long the pack strip stays pulsing after a pack lands (ms). Long enough
 *  to be caught out of the corner of an eye while arranging the pool, short
 *  enough not to become permanent chrome. */
const PULSE_MS = 2500;

/** How often the auto-snap rule is re-evaluated (ms). Sub-second so the pull
 *  back lands well inside the ten-second window it is defending, and cheap:
 *  the tick does a subtraction, and only runs while a timer is live AND the
 *  player is parked on the pool. */
const RECALL_TICK_MS = 250;

/**
 * "A pack arriving while parked on the pool pulses the strip and starts the
 * timer; auto-snap to the pack only if the timer is on and <10s remain"
 * (ADR 0101 §6, issue #2588).
 *
 * Both halves are DEFENSIVE, and that is why they are separated from the
 * scroller itself: a player arranging their pool has to be TOLD a pack landed
 * (the pulse) without having the view yanked out from under them (the
 * auto-snap, which only fires when losing the pick is the bigger harm). The
 * decision itself is the pure `shouldAutoSnapToPack`; this hook is only its
 * clock.
 *
 * The timer needs no starting: it is server-stamped (`seat.pickDeadline`) and
 * the pack pane's status bar — the band the POOL stop leaves visible — mounts
 * the Pick Timer, so a pack landing while the player is on the pool puts a
 * live countdown on screen without a second code path.
 */
export function useDraftPackRecall(input: {
    /** `draftPackIdentity(pack)` — changes exactly when a pack arrives. */
    packIdentity: string | null;
    stop: DraftSnapStop;
    pickDeadline: number | null;
    /** Called when the rule says to pull the view back to the pack. */
    onRecall: () => void;
}): { pulsing: boolean } {
    const { packIdentity, stop, pickDeadline, onRecall } = input;

    // The arrival is detected DURING RENDER (React's "adjusting state when a
    // prop changes" pattern), not in an effect: `react-hooks` forbids a
    // synchronous `setState` inside an effect, and deferring the pulse into a
    // timeout would light the ring a frame after the pack it announces.
    // `seenPack` is the identity this hook has already reacted to.
    const [seenPack, setSeenPack] = useState<string | null>(packIdentity);
    // Two counters rather than a boolean or a deadline: `Date.now()` is an
    // impure call and cannot be made during render, and a plain boolean would
    // let a second arrival inside the same window be swallowed by the FIRST
    // one's expiry. The pulse is on while the arrival counter has outrun the
    // one the expiry timeout acknowledges.
    const [arrivals, setArrivals] = useState(0);
    const [acknowledged, setAcknowledged] = useState(0);
    if (seenPack !== packIdentity) {
        setSeenPack(packIdentity);
        // Only an arrival the player is NOT looking at is worth announcing —
        // on the pack stop the pack IS the screen.
        if (packIdentity !== null && stop === "pool") {
            setArrivals((n) => n + 1);
        }
    }

    // Expiry, and the only place the pulse is cleared. The `setState` lives in
    // the timeout's callback, never in the effect body.
    useEffect(() => {
        if (arrivals === acknowledged) return;
        const id = setTimeout(() => setAcknowledged(arrivals), PULSE_MS);
        return () => clearTimeout(id);
    }, [arrivals, acknowledged]);

    const hasPack = packIdentity !== null;
    // The latest-ref pattern, written in an effect: the caller passes an
    // inline closure, and depending on its identity would tear the interval
    // down and rebuild it on every render.
    const recallRef = useRef(onRecall);
    useEffect(() => {
        recallRef.current = onRecall;
    });

    useEffect(() => {
        if (stop !== "pool" || !hasPack || pickDeadline === null) return;
        const id = setInterval(() => {
            if (
                shouldAutoSnapToPack({
                    stop: "pool",
                    hasPack: true,
                    pickDeadline,
                    now: Date.now(),
                })
            ) {
                recallRef.current();
            }
        }, RECALL_TICK_MS);
        return () => clearInterval(id);
    }, [stop, hasPack, pickDeadline]);

    return { pulsing: arrivals !== acknowledged };
}
