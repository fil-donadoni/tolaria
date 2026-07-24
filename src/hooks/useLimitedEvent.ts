import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// Limited Event skeleton + Sealed flow (PRD #1107, ADR 0054/0055, issue
// #1110). Thin wrapper hooks over `convex/limitedEvents.ts`'s
// queries/mutations — mirrors `src/hooks/useUserDecks.ts`'s shape so
// components never import `convex/react`/`api` directly (CLAUDE.md: types
// come from `convex/`, the frontend only reaches the GRE/domain through
// public mutations/queries).

export type DraftableSetInfo = FunctionReturnType<
    typeof api.limitedEvents.listLimitedDraftableSets
>[number];

// Sourced from a list query (`v.array(limitedEventViewValidator)`, always
// non-null elements) rather than `getLimitedEvent` directly — that query now
// returns `LimitedEventView | null` (issue #1579: a cancelled event a viewer
// is still looking at), and deriving from it here would make every list
// consumer (`LimitedEventList`, `LimitedMyEventsList`, …) fight a spurious
// `| null` in their element type. Same validator underneath either way.
export type LimitedEventView = FunctionReturnType<
    typeof api.limitedEvents.listOpenLimitedEvents
>[number];

export type LimitedEventSeatView = LimitedEventView["seats"][number];

/** Every checked-in Draftable Set plus why a non-Draftable one isn't (PRD
 *  #1107 story 4) — feeds the admin create-event Pack Source picker. */
export function useDraftableSets(): DraftableSetInfo[] | undefined {
    return useQuery(api.limitedEvents.listLimitedDraftableSets);
}

/** Open events (still accepting Seats) — the Limited lobby list. */
export function useOpenLimitedEvents(): LimitedEventView[] | undefined {
    return useQuery(api.limitedEvents.listOpenLimitedEvents);
}

/** Every event (any status) the current user occupies a Seat in. */
export function useMyLimitedEvents(): LimitedEventView[] | undefined {
    return useQuery(api.limitedEvents.myLimitedEvents);
}

/** One event, projected for the current viewer (own Pool visible, every
 *  other seat's stripped). `undefined` id skips the query (still loading);
 *  `null` means the id doesn't resolve to a live event — a bad id, or the
 *  creator cancelled it (issue #1579) while this viewer had it open. */
export function useLimitedEvent(
    eventId: Id<"limitedEvents"> | undefined
): LimitedEventView | null | undefined {
    return useQuery(
        api.limitedEvents.getLimitedEvent,
        eventId ? { eventId } : "skip"
    );
}

export function useLimitedEventMutations() {
    const create = useMutation(api.limitedEvents.createLimitedEvent);
    const join = useMutation(api.limitedEvents.joinLimitedEvent);
    // Leave a Seat / cancel a whole event, both OPEN-only (issue #1579).
    const leave = useMutation(api.limitedEvents.leaveLimitedEvent);
    const cancel = useMutation(api.limitedEvents.cancelLimitedEvent);
    const start = useMutation(api.limitedEvents.startLimitedEvent);
    const submitPick = useMutation(api.limitedEvents.submitPick);
    // Pool Arrangement persistence (ADR 0060, issue #1247).
    const setPoolArrangementEntry = useMutation(
        api.limitedEvents.setPoolArrangementEntry
    );
    // Selected Card (ADR 0060, issue #1248): single-click selection, never a
    // commit — see `convex/limitedEvents.ts`'s `selectDraftPick`.
    const selectDraftPick = useMutation(api.limitedEvents.selectDraftPick);
    return {
        create,
        join,
        leave,
        cancel,
        start,
        submitPick,
        setPoolArrangementEntry,
        selectDraftPick,
    };
}
