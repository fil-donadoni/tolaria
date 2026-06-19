import { useEffect, useRef, useState } from "react";

/**
 * Detects a change in a player's life total and reports the signed delta plus a
 * monotonically-increasing `tick`. The `tick` lets a consumer retrigger an
 * animation even on repeated identical deltas (e.g. two −3s in a row), since the
 * delta value alone wouldn't change.
 *
 * Convex pushes state only at stable points, so several life changes inside a
 * single resolution collapse into one delta here (one combined effect, not one
 * per event) — intended.
 */
export function useLifeDelta(life: number): { delta: number; tick: number } {
    const prev = useRef(life);
    const [state, setState] = useState({ delta: 0, tick: 0 });

    useEffect(() => {
        if (life === prev.current) return;
        const delta = life - prev.current;
        prev.current = life;
        setState((s) => ({ delta, tick: s.tick + 1 }));
    }, [life]);

    return state;
}
