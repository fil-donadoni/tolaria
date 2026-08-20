import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { areDraftPicksLegal } from "@convex/limited/eventStatus";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";

/** Session-scoped marker so the room opens itself ONCE per event per tab —
 *  the SAME shape (and the same reason) as
 *  `useAutoOpenLimitedBuilder`'s `tolaria:limited:autoBuild:*`.
 *
 *  It is what keeps the Draft Room's own "Leave" from bouncing straight back
 *  in. The room is immersive and its overflow is the only way out (ADR 0101
 *  §6); the way out lands on the event page, which is precisely the page this
 *  hook redirects AWAY from while a pick is pending. Without a one-shot the
 *  two would fight, and the event page would be unreachable for the whole
 *  draft. Distinct key from the builder's, and the two can never fire against
 *  the same state anyway: this one needs `!draftCompletedAt`, that one needs
 *  a FINAL pool (`draftCompletedAt` set, or a Sealed event). */
const storageKey = (eventId: string) => `tolaria:limited:draftRoom:${eventId}`;

function alreadyOpened(eventId: string): boolean {
    try {
        return sessionStorage.getItem(storageKey(eventId)) !== null;
    } catch {
        // Private-mode/blocked storage: degrade to "never auto-open" rather
        // than to "auto-open every render", which would trap the player on a
        // page they cannot leave.
        return true;
    }
}

function markOpened(eventId: string): void {
    try {
        sessionStorage.setItem(storageKey(eventId), "1");
    } catch {
        /* ignore — see `alreadyOpened` */
    }
}

/**
 * Sends a seated player from the event page into the Draft Room while a Pick
 * is pending (issue #2587 AC: "the event page redirects while picking").
 *
 * The event page has nothing to offer mid-draft — the pack, the pool, the
 * timer and the table all live in the room now — so landing on it during a
 * draft is a detour, not a destination. It stays REACHABLE (the room's
 * overflow leaves to it, and it offers its own way back in): see the storage
 * marker above for why that is one-shot rather than a standing redirect.
 */
export function useDraftRoomRedirect(
    eventId: Id<"limitedEvents">,
    event: LimitedEventView | null | undefined,
    viewerSeat: LimitedEventView["seats"][number] | undefined
): void {
    const navigate = useNavigate();
    const firedRef = useRef(false);

    const shouldOpen =
        event != null &&
        event.type === "draft" &&
        areDraftPicksLegal(event.status) &&
        event.draftCompletedAt === undefined &&
        viewerSeat !== undefined;

    useEffect(() => {
        if (!shouldOpen || firedRef.current) return;
        if (alreadyOpened(eventId)) return;
        firedRef.current = true;
        markOpened(eventId);
        void navigate({
            to: "/limited/$eventId/draft",
            params: { eventId },
        });
    }, [shouldOpen, eventId, navigate]);
}
