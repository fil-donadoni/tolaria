import { useCallback, useEffect, useState } from "react";
import { holdMs } from "~/lib/random-reveal-pacing";

/** Playback of a Random Reveal's Flip Sequence (CR 705.2, ADR 0023): toss
 *  round 0, HOLD its result for `holdMs`, toss round 1, … until the last round
 *  lands. Client-only; the outcome was decided and persisted server-side.
 *
 *  `shownRound` is the round on screen. `landed` says its coin has landed (its
 *  result is on screen). `ended` is the last round landed — the series is over
 *  and its length may be shown. `jump` is click-to-end: it moves straight to
 *  the last round with `skipped` set, so its coin lands at once. The coin calls
 *  `onLanded` exactly once per round. */
export function useFlipSequencePlayback(rounds: number) {
    const last = Math.max(0, rounds - 1);
    const [round, setRound] = useState(0);
    const [landed, setLanded] = useState(false);
    const [jumped, setJumped] = useState(false);

    const shownRound = jumped ? last : Math.min(round, last);
    const ended = landed && shownRound === last;

    const onLanded = useCallback(() => setLanded(true), []);
    const jump = useCallback(() => {
        if (jumped) return;
        setJumped(true);
        // A coin already landed on an earlier round is replaced by the last
        // one, which lands on its own (skipped) — until then nothing is landed.
        if (shownRound !== last) setLanded(false);
    }, [jumped, shownRound, last]);

    // The hold between two tosses: the landed result stays up, then the next
    // coin is tossed.
    useEffect(() => {
        if (!landed || jumped || shownRound >= last) return;
        const timer = setTimeout(() => {
            setRound(shownRound + 1);
            setLanded(false);
        }, holdMs(shownRound));
        return () => clearTimeout(timer);
    }, [landed, jumped, shownRound, last]);

    return { shownRound, landed, ended, skipped: jumped, onLanded, jump };
}
