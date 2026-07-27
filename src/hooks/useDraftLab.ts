// React state wrapper around the pure Draft Lab engine (issue #1612, ADR
// 0074). Owns the session — seed/source inputs, the current `DraftLabState`,
// which seat is focused, and auto-play — all client-side `useState`, never a
// Convex MUTATION/action. Auto-play is a plain `setInterval` calling the same
// `stepDraftLab` the manual "Step" button calls, so stepping and auto-playing
// are the exact same code path (issue #1612: "step and auto-play controls").
//
// The ONE exception to "no Convex" (issue #1612 fixup): a single read-only
// `useQuery` for Card Profiles (`api.limited.cardProfiles.listScopeCardProfiles`)
// feeds the DB layer `buildDraftLabCardProfile` was previously permanently
// hardwired to `() => null` for. ADR 0074 forbids WRITES ("it writes
// nothing"), not reads — `draft-lab-no-mutation.test.ts` enforces exactly
// that narrower bar (no write-shaped mutation/action hook or `ctx.db.` write
// call anywhere on this surface), and this file adds none of those.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
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
import {
    buildDbProfileLookup,
    type GetCardProfile,
} from "@convex/limited/cardProfiles";

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
    /** False until the Card Profile query has resolved (ADR 0072, issue
     *  #1611). Profiles are SCORE-BEARING now, and `initDraftLab` freezes them
     *  into the session state, so starting before the rows land would silently
     *  snapshot an EMPTY profile set and score the whole draft without the
     *  synergy terms — a draft that looks fine and is not the draft the same
     *  seed produces a second later. The Draft Lab controls disable Start
     *  while this is false. */
    canStart: boolean;
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

    // Live DB-layer Card Profiles for the current Pack Source scope(s) — a
    // read-only query, `undefined` while the first response hasn't landed
    // yet (`buildDbProfileLookup(undefined ?? [])` degrades to "no DB rows",
    // the SAME empty-layer behavior the seed-only path already had, so a
    // slow/loading query never breaks rendering, only delays a badge).
    const scopeCardProfiles = useQuery(
        api.limited.cardProfiles.listScopeCardProfiles,
        { scopes: packSlots }
    );
    const getCardProfile = useMemo(
        () =>
            buildDraftLabCardProfile(
                packSlots,
                buildDbProfileLookup(scopeCardProfiles ?? [])
            ),
        [packSlots, scopeCardProfiles]
    );

    // Both halves of the determinism fix (issue #1611): Start is GATED on the
    // query having resolved, and the rows it did resolve to are SNAPSHOTTED
    // into the session state, so no live query result is ever read again for
    // the rest of the run. Either half alone leaks — a gate without a snapshot
    // still lets a re-fetch mid-draft change a pick; a snapshot without a gate
    // silently freezes an empty profile set when Start beats the query.
    const canStart = scopeCardProfiles !== undefined;
    const start = useCallback(() => {
        if (scopeCardProfiles === undefined) return;
        setIsAutoPlaying(false);
        setState(
            initDraftLab(
                seedInput,
                packSlots,
                DRAFT_LAB_SEAT_COUNT,
                scopeCardProfiles
            )
        );
        setFocusedSeat(0);
    }, [seedInput, packSlots, scopeCardProfiles]);

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
        canStart,
    };
}
