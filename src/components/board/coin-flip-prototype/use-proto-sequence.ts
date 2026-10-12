// PROTOTYPE (issue #4433) — throwaway. Drives a flip sequence: accelerating
// pacing, click-to-end, simulated ack (flipper's client / Bot waits the full
// duration), then an ephemeral summary.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProtoScenario } from "./prototype-scenarios";

const FIRST_MS = 1600; // today's FLIP_ANIM_MS
const DECAY = 0.6;
const MIN_MS = 380;
const HOLD_AFTER_LAND_MS = 900; // read the last face before the ack
const SUMMARY_MS = 4000;

export function roundDurationMs(i: number): number {
    return Math.max(MIN_MS, Math.round(FIRST_MS * Math.pow(DECAY, i)));
}

export function sequenceDurationMs(rounds: number): number {
    let t = 0;
    for (let i = 0; i < rounds; i++) t += roundDurationMs(i);
    return t + HOLD_AFTER_LAND_MS;
}

export type Phase = "revealing" | "landed" | "summary" | "closed";

export type ProtoSequence = {
    phase: Phase;
    /** Rounds whose coins have landed. */
    landed: number;
    /** Round currently spinning (=== landed while revealing), -1 when none. */
    spinning: number;
    spinMs: number;
    skipped: boolean;
    skipToEnd: () => void;
    elapsedMs: number;
};

export function useProtoSequence(
    scenario: ProtoScenario,
    runId: number
): ProtoSequence {
    const total = scenario.rounds.length;
    const [landed, setLanded] = useState(0);
    const [phase, setPhase] = useState<Phase>("revealing");
    const [skipped, setSkipped] = useState(false);
    const [elapsedMs, setElapsed] = useState(0);
    const start = useRef(performance.now());

    useEffect(() => {
        setLanded(0);
        setPhase("revealing");
        setSkipped(false);
        start.current = performance.now();
    }, [scenario.key, runId]);

    // Advance one round at a time with accelerating pacing.
    useEffect(() => {
        if (phase !== "revealing") return;
        if (landed >= total) {
            setPhase("landed");
            return;
        }
        const t = setTimeout(
            () => setLanded((n) => n + 1),
            roundDurationMs(landed)
        );
        return () => clearTimeout(t);
    }, [phase, landed, total]);

    // Ack: the acker's client acks after the hold. A Bot acker waits the
    // full sequence duration (grill decision 4) — modelled as the same hold
    // unless the human skipped (a viewer skip never shortens the Bot's wait,
    // but the overlay still shows the landed result until the Bot acks).
    useEffect(() => {
        if (phase !== "landed") return;
        const botWaitsRemaining =
            scenario.acker === "opp" && skipped
                ? Math.max(
                      HOLD_AFTER_LAND_MS,
                      sequenceDurationMs(total) -
                          (performance.now() - start.current)
                  )
                : HOLD_AFTER_LAND_MS;
        const t = setTimeout(() => setPhase("summary"), botWaitsRemaining);
        return () => clearTimeout(t);
    }, [phase, scenario.acker, skipped, total]);

    useEffect(() => {
        if (phase !== "summary") return;
        const t = setTimeout(() => setPhase("closed"), SUMMARY_MS);
        return () => clearTimeout(t);
    }, [phase]);

    useEffect(() => {
        const id = setInterval(
            () => setElapsed(performance.now() - start.current),
            100
        );
        return () => clearInterval(id);
    }, [runId, scenario.key]);

    const skipToEnd = useCallback(() => {
        if (phase !== "revealing") return;
        setSkipped(true);
        setLanded(total);
        setPhase("landed");
    }, [phase, total]);

    return {
        phase,
        landed,
        spinning: phase === "revealing" && landed < total ? landed : -1,
        spinMs: roundDurationMs(landed),
        skipped,
        skipToEnd,
        elapsedMs,
    };
}
