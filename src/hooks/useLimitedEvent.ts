import { useState } from "react";
import { useMutation, useQuery, type ReactMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { usePageVisible } from "~/hooks/usePageVisible";

// Limited Event skeleton + Sealed flow (PRD #1107, ADR 0054/0055, issue
// #1110). Thin wrapper hooks over `convex/limitedEvents.ts`'s
// queries/mutations — mirrors `src/hooks/useUserDecks.ts`'s shape so
// components never import `convex/react`/`api` directly (CLAUDE.md: types
// come from `convex/`, the frontend only reaches the GRE/domain through
// public mutations/queries).

export type DraftableSetInfo = FunctionReturnType<
    typeof api.limitedEvents.listLimitedDraftableSets
>[number];

// The FULL event view — every seat's Pool/pack/arrangement, as far as the
// viewer is allowed to see them. Sourced from `getLimitedEvent`, stripped of
// its `| null` (issue #1579: that query returns null for an event cancelled
// out from under a live viewer; carrying the null into this alias would make
// every consumer fight a spurious union).
export type LimitedEventView = NonNullable<
    FunctionReturnType<typeof api.limitedEvents.getLimitedEvent>
>;

// The LIST view — deliberately narrower (see `limitedEventSummaryValidator` in
// `convex/limitedEvents.ts`): event name/phase plus seat identity, and none of
// the card payload. It is a distinct type rather than `LimitedEventView` with
// empty fields precisely so a component that reaches for a Pool on a list row
// fails to compile: the list queries answer from the slim event row alone, and
// re-widening them is what made a backgrounded lobby re-read every Pool in the
// table on every draft pick.
export type LimitedEventSummaryView = FunctionReturnType<
    typeof api.limitedEvents.listOpenLimitedEvents
>[number];

export type LimitedEventSeatView = LimitedEventView["seats"][number];

/** Every checked-in Draftable Set plus why a non-Draftable one isn't (PRD
 *  #1107 story 4) — feeds the admin create-event Pack Source picker. */
export function useDraftableSets(): DraftableSetInfo[] | undefined {
    return useQuery(api.limitedEvents.listLimitedDraftableSets);
}

// Both list queries below are gated on tab visibility, mirroring the lobby's
// `api.decks.list` / `api.game.listOpenGames` subscriptions. They are LIST
// scans over `limitedEvents`, so every write to ANY event re-runs them and
// re-reads every scanned row; leaving them subscribed behind a hidden tab was
// the single largest source of Convex database read bytes in development (a
// backgrounded lobby paid a full re-scan per draft pick). A hidden tab renders
// nothing, so dropping the subscription costs no visible freshness — the query
// re-runs on `visibilitychange`.

/** Open events (still accepting Seats) — the Limited lobby list. */
export function useOpenLimitedEvents(): LimitedEventSummaryView[] | undefined {
    const pageVisible = usePageVisible();
    return useQuery(
        api.limitedEvents.listOpenLimitedEvents,
        pageVisible ? {} : "skip"
    );
}

/** Every event (any status) the current user occupies a Seat in — backs
 *  `/limited/events` and the Draft Lab's replay picker. Includes concluded
 *  events; see `useMyCurrentLimitedEvents` for the narrowed, live-only cut. */
export function useMyLimitedEvents(): LimitedEventSummaryView[] | undefined {
    const pageVisible = usePageVisible();
    return useQuery(
        api.limitedEvents.myLimitedEvents,
        pageVisible ? {} : "skip"
    );
}

/** Every event the current user occupies a Seat in that hasn't concluded yet
 *  (issue #2357) — feeds the dashboard's Limited box and the Limited Events
 *  page's own seated-events section ("Your Current Events"). Narrower than
 *  `useMyLimitedEvents`: a concluded event drops off this one but stays on
 *  `/limited/events`. */
export function useMyCurrentLimitedEvents(
    /**
     * `false` skips the subscription outright, for a caller that is mounted
     * where its own result is discarded (issue #2582 review: `AppShell` mounts
     * on EVERY route including the board, where no band that could show an
     * event is rendered). This query scans the `limitedEvents` table — whose
     * documents embed `seats[].pool`, `currentPack` and `rounds` — and
     * re-executes for every subscribed client on every write to any of them,
     * i.e. on every draft pick anywhere in the app. An always-live subscriber
     * that throws the answer away is not free.
     */
    enabled = true
): LimitedEventSummaryView[] | undefined {
    const pageVisible = usePageVisible();
    return useQuery(
        api.limitedEvents.myCurrentLimitedEvents,
        enabled && pageVisible ? {} : "skip"
    );
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

/** Single-in-flight Join flow (issue #2648): guards a second Join firing
 *  while one is outstanding, surfaces a server rejection (already seated,
 *  event full, event already started) as a readable message rather than an
 *  uncaught rejection, and calls `onJoined` ONLY on success so the caller can
 *  navigate to the event it just seated the viewer in.
 *
 *  Shared by the Limited Events page's own Join row (`limited-events-
 *  page.tsx`, PRD #1107 story 7) and the lobby dashboard's inline Join
 *  affordance (`dashboard-limited-box.tsx`, wired from `lobby.tsx`) — the
 *  SECOND call site is what promotes this from a local closure to a shared
 *  hook (CLAUDE.md: extract after the second) rather than growing a second,
 *  independently-drifting copy of the same pending/error/navigate dance.
 *
 *  Takes the `join` mutation as a PARAMETER instead of calling `useMutation`
 *  itself: `limited-events-page.tsx` already holds it via
 *  `useLimitedEventMutations()` (which also gives it `create`), so this
 *  never opens a second subscription for the same mutation, and a caller
 *  that only needs Join (the lobby) can get its own single `useMutation`
 *  call without pulling in the other seven `useLimitedEventMutations`
 *  bundles. */
export function useJoinLimitedEvent(
    join: ReactMutation<typeof api.limitedEvents.joinLimitedEvent>,
    onJoined: (eventId: Id<"limitedEvents">) => void
): {
    handleJoin: (eventId: Id<"limitedEvents">) => Promise<void>;
    joinPendingEventId: Id<"limitedEvents"> | null;
    joinError: string | null;
} {
    const [joinPendingEventId, setJoinPendingEventId] =
        useState<Id<"limitedEvents"> | null>(null);
    const [joinError, setJoinError] = useState<string | null>(null);

    const handleJoin = async (eventId: Id<"limitedEvents">) => {
        if (joinPendingEventId) return;
        setJoinPendingEventId(eventId);
        setJoinError(null);
        try {
            await join({ eventId });
            onJoined(eventId);
        } catch (err) {
            setJoinError(
                err instanceof Error ? err.message : "Failed to join event."
            );
        } finally {
            setJoinPendingEventId(null);
        }
    };

    return { handleJoin, joinPendingEventId, joinError };
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
