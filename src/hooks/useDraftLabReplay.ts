// React state wrapper around the pure replay-reconstruction engine (issue
// #1613, ADR 0074 "Draft Lab: replay mode"). Owns which completed Draft event
// is selected and runs `reconstructDraftReplay` against it — a pure, memoized
// computation, never a Convex mutation. Two read-only `useQuery`s live here
// (`useMyLimitedEvents` and, since the #1613 fixup below, a live
// `cardRatings` scope read) — reads are not writes, and
// `draft-lab-no-mutation.test.ts` enforces exactly that narrower bar across
// every Draft Lab file, this one included.
//
// Pre-merge review finding 2 (#1613 fixup): the ORIGINAL version scored every
// "recomputed" pick off `buildDraftLabPickRating` — the checked-in seed file
// ONLY, `GetDbRating` hardwired to `() => null`. That is the synthetic Draft
// Lab's own honest contract (no real event exists to read a database layer
// for), but the REPLAY surface reconstructs a REAL event, which was actually
// drafted under `convex/limitedEvents.ts`'s `loadEventPickRating` — a layered
// lookup that DOES fold in any admin-edited `cardRatings` row (PRD #1296).
// Scoring the replay off the seed file alone made "recomputed" diverge from
// history for reasons that have nothing to do with the scorer changing on
// any deployment carrying an edited rating — a permanently spurious
// `firstDivergedPickIndex`. This file now reads the SAME `cardRatings` rows
// through a dedicated read-only query (`listScopeCardRatingsForReplay`,
// mirroring `useDraftLab.ts`'s Card Profiles read) and layers them with the
// exact same `resolveEventPickRating` the server uses.
//
// Determinism (mirrors issue #1611's `DraftLabState.cardProfileRows` fix,
// `src/hooks/useDraftLab.ts`/`draftLabEngine.ts`): a live `useQuery` result
// feeds this reconstruction's PICK DECISIONS directly (unlike Card Profiles
// on the synthetic Lab's badge-only path), so reading it straight into
// `reconstructDraftReplay` on every render would make the "recomputed"
// column depend on WHEN the query happened to resolve relative to selecting
// the event — not a property of the event or the scorer at all.
// `ratingsSnapshot` below freezes the resolved rows the FIRST time they land
// for the currently selected event, and `result` refuses to compute until
// that snapshot exists for that exact event — the two-part gate-and-snapshot
// fix `useDraftLab.ts`'s doc comment describes for the synthetic engine.
//
// The snapshot is captured by ADJUSTING STATE DURING RENDER (React-endorsed:
// react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
// not inside a `useEffect` — a `useEffect`-based sync here would fire
// `react-hooks`'s `set-state-in-effect` rule (a direct, synchronous
// `setState` call in an effect's own body), the same lint bar
// `useDraftLab.ts`'s doc comment notes its OWN stable-interval callback
// deliberately stays clear of. Both `setRatingsSnapshot` calls below are
// conditional on an inequality check against the value they'd set, so each
// fires at most once per actual change — no infinite render loop.
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useMyLimitedEvents, type LimitedEventView } from "./useLimitedEvent";
import { draftLabGetCardEvalMeta } from "@/lib/limited/draftLabCardMeta";
import {
    reconstructDraftReplay,
    type ReplayEventSeatInput,
    type ReplayResult,
} from "@/lib/limited/draftReplayEngine";
import {
    buildDbRatingLookup,
    resolveEventPickRating,
    type ScopedCardRating,
} from "@convex/limited/cardRatings";

export interface UseDraftLabReplayResult {
    /** Every completed Draft event the current user occupies a Seat in —
     *  `undefined` while `myLimitedEvents` hasn't answered yet. A Sealed
     *  event has no picks/passing to replay (ADR 0074 scope), so it's
     *  filtered out here rather than in every consumer. */
    replayableEvents: LimitedEventView[] | undefined;
    selectedEventId: string | null;
    selectEvent: (eventId: string | null) => void;
    selectedEvent: LimitedEventView | null;
    /** `null` before an event is selected, when the selected event has no
     *  `seed` (see `eventProjection.ts`'s `LimitedEventView.seed` doc — since
     *  the #1613 fixup this is the common case for a NON-ADMIN viewer, not
     *  just "still loading"), or while `ratingsLoading` is true for that
     *  event (the DB Pick Rating snapshot hasn't landed yet — see
     *  `ratingsLoading`). */
    result: ReplayResult | null;
    /** True once an event with a visible `seed` is selected but this file's
     *  own `cardRatings` scope read hasn't resolved (and been snapshotted)
     *  for THAT event yet. The panel uses this to show a "loading" state
     *  instead of a misleading blank gap between selecting an event and
     *  `result` appearing. Always `false` when no event is selected or the
     *  selected event has no seed — there is nothing to wait for either
     *  way. */
    ratingsLoading: boolean;
}

export function useDraftLabReplay(): UseDraftLabReplayResult {
    const events = useMyLimitedEvents();
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

    const replayableEvents = useMemo(
        () => events?.filter((e) => e.type === "draft" && e.completed),
        [events]
    );

    const selectedEvent = useMemo(
        () => replayableEvents?.find((e) => e._id === selectedEventId) ?? null,
        [replayableEvents, selectedEventId]
    );

    const canReconstruct = selectedEvent != null && selectedEvent.seed != null;

    // Live DB-layer Pick Ratings for the selected event's scopes (finding 2
    // above) — skipped entirely (`"skip"`) whenever there's nothing to
    // reconstruct yet, so a non-admin viewer (whose `selectedEvent.seed` is
    // always `null` post-fixup) never fires this query for nothing.
    const scopeCardRatings = useQuery(
        api.limited.cardRatings.listScopeCardRatingsForReplay,
        canReconstruct ? { scopes: selectedEvent.packSlots } : "skip"
    );

    // SNAPSHOT, keyed to the event it was read for — see the module doc
    // comment. Adjusted DURING RENDER, not via `useEffect` (see the module
    // doc comment for why): reset to `null` the instant the selection
    // changes so a STALE snapshot from a PREVIOUS event can never be read as
    // the new event's ratings before its own query lands, then capture the
    // resolved rows for the CURRENT event once they land. The two branches
    // are mutually exclusive (a selection change and a query landing can't
    // both be "new" on the same render) and each only fires when its target
    // state actually differs from the current one, so this settles in a
    // bounded number of renders, never loops.
    const [ratingsSnapshot, setRatingsSnapshot] = useState<{
        eventId: string;
        rows: readonly ScopedCardRating[];
    } | null>(null);

    if (ratingsSnapshot && ratingsSnapshot.eventId !== selectedEventId) {
        setRatingsSnapshot(null);
    } else if (
        canReconstruct &&
        scopeCardRatings !== undefined &&
        (!ratingsSnapshot || ratingsSnapshot.eventId !== selectedEvent._id)
    ) {
        setRatingsSnapshot({
            eventId: selectedEvent._id,
            rows: scopeCardRatings,
        });
    }

    const ratingsLoading =
        canReconstruct &&
        (!ratingsSnapshot || ratingsSnapshot.eventId !== selectedEvent._id);

    const result = useMemo<ReplayResult | null>(() => {
        if (!selectedEvent || selectedEvent.seed == null) return null;
        if (!ratingsSnapshot || ratingsSnapshot.eventId !== selectedEvent._id) {
            return null;
        }
        const seed = selectedEvent.seed;
        const packSlots = selectedEvent.packSlots;
        const getDbRating = buildDbRatingLookup(ratingsSnapshot.rows);
        const getPickRating = resolveEventPickRating(packSlots, getDbRating);
        const seatInputs: ReplayEventSeatInput[] = selectedEvent.seats.map(
            (s) => ({
                seatIndex: s.seatIndex,
                isBot: s.isBot,
                pool: s.pool,
            })
        );
        return reconstructDraftReplay(
            seed,
            packSlots,
            seatInputs,
            draftLabGetCardEvalMeta,
            getPickRating
        );
    }, [selectedEvent, ratingsSnapshot]);

    return {
        replayableEvents,
        selectedEventId,
        selectEvent: setSelectedEventId,
        selectedEvent,
        result,
        ratingsLoading,
    };
}
