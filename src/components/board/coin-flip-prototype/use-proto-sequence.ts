// PROTOTYPE (issue #4433) — throwaway. Drives a flip sequence: each round is
// TOSSED, then its result is SHOWN (held) before the next toss starts; tosses
// accelerate, holds shrink a little. Click-to-end, simulated ack (flipper's
// client / Bot waits the full duration), then an ephemeral summary.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProtoScenario } from "./prototype-scenarios";

const FIRST_TOSS_MS = 1600; // today's FLIP_ANIM_MS
const TOSS_DECAY = 0.7;
const MIN_TOSS_MS = 650;
const FIRST_HOLD_MS = 1100;
const MIN_HOLD_MS = 650;
const FINAL_HOLD_MS = 1400; // read the last result before the ack
const SUMMARY_MS = 4000;

export function tossMs(i: number): number {
    return Math.max(
        MIN_TOSS_MS,
        Math.round(FIRST_TOSS_MS * Math.pow(TOSS_DECAY, i))
    );
}

export function holdMs(i: number): number {
    return Math.max(MIN_HOLD_MS, FIRST_HOLD_MS - i * 120);
}

export function sequenceDurationMs(rounds: number): number {
    let t = 0;
    for (let i = 0; i < rounds; i++)
        t += tossMs(i) + (i < rounds - 1 ? holdMs(i) : 0);
    return t + FINAL_HOLD_MS;
}

export type Phase = "revealing" | "landed" | "summary" | "closed";

export type ProtoSequence = {
    phase: Phase;
    /** Rounds whose coins have landed. */
    landed: number;
    /** Round currently in the air, -1 when none (holding / done). */
    spinning: number;
    /** Round whose result is being held on screen, -1 when none. */
    showing: number;
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
    const [holding, setHolding] = useState(false);
    const [phase, setPhase] = useState<Phase>("revealing");
    const [skipped, setSkipped] = useState(false);
    const [elapsedMs, setElapsed] = useState(0);
    const start = useRef(performance.now());

    useEffect(() => {
        setLanded(0);
        setHolding(false);
        setPhase("revealing");
        setSkipped(false);
        start.current = performance.now();
    }, [scenario.key, runId]);

    // toss → land → hold → next toss …; the last hold hands over to "landed".
    useEffect(() => {
        if (phase !== "revealing") return;
        if (!holding) {
            const t = setTimeout(() => {
                setLanded((n) => n + 1);
                setHolding(true);
            }, tossMs(landed));
            return () => clearTimeout(t);
        }
        if (landed >= total) {
            setPhase("landed");
            return;
        }
        const t = setTimeout(() => setHolding(false), holdMs(landed - 1));
        return () => clearTimeout(t);
    }, [phase, holding, landed, total]);

    // Ack after the final hold. A Bot acker waits the full sequence duration
    // (grill decision 4): a viewer's skip never shortens the Bot's wait.
    useEffect(() => {
        if (phase !== "landed") return;
        const wait =
            scenario.acker === "opp" && skipped
                ? Math.max(
                      FINAL_HOLD_MS,
                      sequenceDurationMs(total) -
                          (performance.now() - start.current)
                  )
                : FINAL_HOLD_MS;
        const t = setTimeout(() => setPhase("summary"), wait);
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
        setHolding(true);
        setPhase("landed");
    }, [phase, total]);

    const inAir = phase === "revealing" && !holding && landed < total;
    return {
        phase,
        landed,
        spinning: inAir ? landed : -1,
        showing: inAir ? -1 : landed - 1,
        spinMs: tossMs(landed),
        skipped,
        skipToEnd,
        elapsedMs,
    };
}
