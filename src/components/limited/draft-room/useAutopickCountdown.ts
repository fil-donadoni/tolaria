import { useEffect, useState } from "react";
import { autopickCueSeconds } from "./autopickTarget";

const POLL_MS = 250;

/** Seconds left on the Pick clock while inside the Auto-Pick cue window, else
 *  `null` (issue #9165). Polls faster than the Pick Timer's own 1 s tick so
 *  the two readouts never visibly disagree, but the state holds only the
 *  whole-second cue, so the table re-renders once per second inside the
 *  window and never outside it. The value is tagged with the deadline it was
 *  computed for: a previous Pick's cue can never paint on the next pack. */
export function useAutopickCountdown(pickDeadline: number | null) {
    const [cue, setCue] = useState(() => ({
        deadline: pickDeadline,
        seconds: autopickCueSeconds(pickDeadline, Date.now()),
    }));
    useEffect(() => {
        if (pickDeadline === null) return;
        const id = setInterval(() => {
            const seconds = autopickCueSeconds(pickDeadline, Date.now());
            setCue((prev) =>
                prev.deadline === pickDeadline && prev.seconds === seconds
                    ? prev
                    : { deadline: pickDeadline, seconds }
            );
        }, POLL_MS);
        return () => clearInterval(id);
    }, [pickDeadline]);
    return cue.deadline === pickDeadline ? cue.seconds : null;
}
