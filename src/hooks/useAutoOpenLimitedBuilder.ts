import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";

/** Session-scoped marker so the auto-open fires ONCE per event per tab. The
 *  builder's own "← Back to Event" must land on the event page and stay
 *  there — without this the effect would immediately bounce the player back
 *  into the builder, making the event page unreachable until they submit. */
const storageKey = (eventId: string) => `tolaria:limited:autoBuild:${eventId}`;

function alreadyOpened(eventId: string): boolean {
    try {
        return sessionStorage.getItem(storageKey(eventId)) !== null;
    } catch {
        // Private-mode/blocked storage: degrade to "never auto-open" rather
        // than to "auto-open every render", which would trap the player.
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
 * Sends a seated player straight into the deck builder the moment their Pool
 * becomes final and they have no deck yet — the end of a Draft (or the start
 * of a Sealed event) IS the start of deck building, so the event page has
 * nothing to offer in between (it used to render a read-only copy of the Pool
 * the builder shows better, behind a "Build Deck" button).
 *
 * Deliberately one-shot per tab (see `alreadyOpened`) and never fired for a
 * seat that already submitted a deck — that player is done building and wants
 * the table summary and the match lobby instead.
 */
export function useAutoOpenLimitedBuilder(
    eventId: Id<"limitedEvents">,
    event: LimitedEventView | null | undefined,
    viewerSeat: LimitedEventView["seats"][number] | undefined
): void {
    const navigate = useNavigate();
    const firedRef = useRef(false);

    const poolIsFinal =
        event != null &&
        event.status === "started" &&
        (event.type === "sealed" || event.draftCompletedAt !== undefined);
    const shouldOpen =
        poolIsFinal && viewerSeat !== undefined && !viewerSeat.hasDeck;

    useEffect(() => {
        if (!shouldOpen || firedRef.current) return;
        if (alreadyOpened(eventId)) return;
        firedRef.current = true;
        markOpened(eventId);
        void navigate({
            to: "/limited/$eventId/build",
            params: { eventId },
        });
    }, [shouldOpen, eventId, navigate]);
}
