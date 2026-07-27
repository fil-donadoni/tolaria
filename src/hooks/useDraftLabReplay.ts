// React state wrapper around the pure replay-reconstruction engine (issue
// #1613, ADR 0074 "Draft Lab: replay mode"). Owns which completed Draft event
// is selected and runs `reconstructDraftReplay` against it — a pure, memoized
// computation, never a Convex mutation. The ONE Convex access on this surface
// is `useMyLimitedEvents` (`src/hooks/useLimitedEvent.ts`), a read-only
// `useQuery` — reads are not writes, and `draft-lab-no-mutation.test.ts`
// enforces exactly that narrower bar across every Draft Lab file, this one
// included.
import { useMemo, useState } from "react";
import { useMyLimitedEvents, type LimitedEventView } from "./useLimitedEvent";
import { buildDraftLabPickRating } from "@/lib/limited/draftLabEngine";
import { draftLabGetCardEvalMeta } from "@/lib/limited/draftLabCardMeta";
import {
    reconstructDraftReplay,
    type ReplayEventSeatInput,
    type ReplayResult,
} from "@/lib/limited/draftReplayEngine";

export interface UseDraftLabReplayResult {
    /** Every completed Draft event the current user occupies a Seat in —
     *  `undefined` while `myLimitedEvents` hasn't answered yet. A Sealed
     *  event has no picks/passing to replay (ADR 0074 scope), so it's
     *  filtered out here rather than in every consumer. */
    replayableEvents: LimitedEventView[] | undefined;
    selectedEventId: string | null;
    selectEvent: (eventId: string | null) => void;
    selectedEvent: LimitedEventView | null;
    /** `null` before an event is selected, or when the selected event has no
     *  `seed` yet — see `eventProjection.ts`'s `LimitedEventView.seed` doc
     *  (only a `completed` event ever carries one on the wire, and
     *  `replayableEvents` already filters to `completed` events, so `null`
     *  here in practice means "still loading"). */
    result: ReplayResult | null;
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

    const result = useMemo<ReplayResult | null>(() => {
        if (!selectedEvent || selectedEvent.seed == null) return null;
        const seed = selectedEvent.seed;
        const packSlots = selectedEvent.packSlots;
        const getPickRating = buildDraftLabPickRating(packSlots);
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
    }, [selectedEvent]);

    return {
        replayableEvents,
        selectedEventId,
        selectEvent: setSelectedEventId,
        selectedEvent,
        result,
    };
}
