// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-autopick`). Never merge.
import { useEffect, useState } from "react";
import { usePrototypeVariant } from "~/components/prototype/prototype-switcher";

/** Owner decision (2026-11): the highlight fires in the LAST 5 SECONDS of the
 *  pick clock (the timer bar itself still turns red at 10). */
export const PROTOTYPE_AUTOPICK_SECONDS = 5;

/** Seconds left on the pick clock + whether we are in its last 5 s.
 *  `?pv-urgent=1` forces `urgent` so the state can be judged without waiting. */
export function usePrototypeSecondsLeft(pickDeadline: number | null): {
    seconds: number | null;
    urgent: boolean;
} {
    const forced = usePrototypeVariant("pv-urgent") !== null;
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (pickDeadline === null) return;
        const id = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(id);
    }, [pickDeadline]);
    const seconds =
        pickDeadline === null
            ? null
            : Math.max(0, Math.ceil((pickDeadline - now) / 1000));
    return {
        seconds,
        urgent:
            forced ||
            (seconds !== null && seconds <= PROTOTYPE_AUTOPICK_SECONDS),
    };
}
