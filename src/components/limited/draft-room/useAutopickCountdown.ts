import { useEffect, useState } from "react";
import { autopickCueSeconds } from "./autopickTarget";

const POLL_MS = 250;

/** Seconds left on the Pick clock while inside the Auto-Pick cue window, else
 *  `null` (issue #9165). Polls faster than the Pick Timer's own 1 s tick so
 *  the two readouts never visibly disagree; state only changes when the whole
 *  second does. */
export function useAutopickCountdown(pickDeadline: number | null) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (pickDeadline === null) return;
        const id = setInterval(() => setNow(Date.now()), POLL_MS);
        return () => clearInterval(id);
    }, [pickDeadline]);
    return autopickCueSeconds(pickDeadline, now);
}
