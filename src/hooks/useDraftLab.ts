// React state wrapper around the pure Draft Lab engine (issue #1612, ADR
// 0074). Owns the session — seed/source inputs, the current `DraftLabState`,
// which seat is focused, and auto-play — all client-side `useState`, never a
// Convex mutation/query. Auto-play is a plain `setInterval` calling the same
// `stepDraftLab` the manual "Step" button calls, so stepping and auto-playing
// are the exact same code path (issue #1612: "step and auto-play controls").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    DRAFT_LAB_SEAT_COUNT,
    buildDraftLabCardProfile,
    buildDraftLabPickRating,
    initDraftLab,
    standardPackSlots,
    stepDraftLab,
    type DraftLabState,
} from "@/lib/limited/draftLabEngine";
import { CUBE_SOURCE_KEY } from "@convex/limited/cubeSource";
import type { GetCardProfile } from "@convex/limited/cardProfiles";

/** Arbitrary, memorable default — any seed the user types behaves
 *  identically (issue #1612: "generate a draft from an arbitrary seed"). */
const DEFAULT_SEED = 20260727;

const AUTO_PLAY_INTERVAL_MS = 350;

export interface UseDraftLabResult {
    state: DraftLabState | null;
    seedInput: number;
    setSeedInput: (seed: number) => void;
    sourceKey: string;
    setSourceKey: (key: string) => void;
    focusedSeat: number;
    setFocusedSeat: (seat: number) => void;
    isAutoPlaying: boolean;
    start: () => void;
    step: () => void;
    toggleAutoPlay: () => void;
    getCardProfile: GetCardProfile;
}

export function useDraftLab(): UseDraftLabResult {
    const [seedInput, setSeedInput] = useState(DEFAULT_SEED);
    const [sourceKey, setSourceKey] = useState(CUBE_SOURCE_KEY);
    const [state, setState] = useState<DraftLabState | null>(null);
    const [focusedSeat, setFocusedSeat] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(false);

    const packSlots = useMemo(() => standardPackSlots(sourceKey), [sourceKey]);
    const getPickRating = useMemo(
        () => buildDraftLabPickRating(packSlots),
        [packSlots]
    );
    const getCardProfile = useMemo(
        () => buildDraftLabCardProfile(packSlots),
        [packSlots]
    );

    const start = useCallback(() => {
        setIsAutoPlaying(false);
        setState(initDraftLab(seedInput, packSlots, DRAFT_LAB_SEAT_COUNT));
        setFocusedSeat(0);
    }, [seedInput, packSlots]);

    const step = useCallback(() => {
        setState((prev) =>
            prev && !prev.completed ? stepDraftLab(prev, getPickRating) : prev
        );
    }, [getPickRating]);

    const toggleAutoPlay = useCallback(() => {
        setIsAutoPlaying((v) => !v);
    }, []);

    // `stateRef` mirrors `state` for the interval callback below — a plain
    // ref write, not a `setState` call, so syncing it is not the "setState
    // synchronously within an effect" pattern the lint rule flags.
    const stateRef = useRef(state);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    // Auto-play: a stable interval (never restarted per pick) driving the
    // same `stepDraftLab` call the manual button uses. Stopping on
    // completion happens INSIDE the timer callback (an async subscription
    // tick, not the effect body itself) — the react-hooks lint rule targets
    // a direct, synchronous `setState` call in an effect's own body, which
    // this isn't.
    useEffect(() => {
        if (!isAutoPlaying) return;
        const id = setInterval(() => {
            const prev = stateRef.current;
            if (!prev || prev.completed) {
                clearInterval(id);
                setIsAutoPlaying(false);
                return;
            }
            setState(stepDraftLab(prev, getPickRating));
        }, AUTO_PLAY_INTERVAL_MS);
        return () => clearInterval(id);
    }, [isAutoPlaying, getPickRating]);

    return {
        state,
        seedInput,
        setSeedInput,
        sourceKey,
        setSourceKey,
        focusedSeat,
        setFocusedSeat,
        isAutoPlaying,
        start,
        step,
        toggleAutoPlay,
        getCardProfile,
    };
}
