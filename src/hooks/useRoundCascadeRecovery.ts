import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { areRoundsRunning } from "@convex/limited/eventStatus";
import { isRoundComplete } from "@convex/limited/rounds";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";

/** Client-side RECOVERY for an event whose latest round is fully decided but
 *  which never advanced — the counterpart to `limitedEvents.nudgeEventRounds`.
 *
 *  Every round normally advances inside the same server write that decides it,
 *  so this fires for exactly one reason: that write's cascade didn't run.
 *  `recordLimitedPairingResult` and `expireRoundDeadline` both swallow a
 *  cascade throw on purpose (the recorded result must survive), and nothing
 *  ever retried afterwards — the event then sat on a complete round with no
 *  pairing left to play and no deadline left to fire, which is precisely the
 *  state no other entry point can reach (see the mutation's own comment).
 *  A seat looking at the event is the one signal that reliably still arrives,
 *  so that is what we hang the retry on.
 *
 *  Fires at most ONCE per observed round state. The key is the event's whole
 *  round shape (`currentRound` + how many rounds exist), so a successful nudge
 *  changes the key and the next stuck state is a fresh attempt, while a nudge
 *  that throws or no-ops is NOT retried against the same state — a mutation
 *  re-fired from an effect that its own failure leaves eligible is an infinite
 *  loop, and this one is safe to simply not retry: the next round transition,
 *  or the next mount, tries again. */
export function useRoundCascadeRecovery({
    eventId,
    event,
    enabled,
}: {
    eventId: Id<"limitedEvents">;
    /** `undefined` while the event query is in flight, `null` for an event
     *  cancelled out from under the viewer — both simply mean "nothing to
     *  recover yet". Accepted (rather than gated at the call site) because
     *  this is a hook: it must run on every render, including the ones before
     *  the event has loaded. */
    event: LimitedEventView | null | undefined;
    /** Whether the viewer holds a Seat — `nudgeEventRounds` rejects anyone
     *  else, so calling it from a spectator's page would only log errors. */
    enabled: boolean;
}): void {
    const nudge = useMutation(api.limitedEvents.nudgeEventRounds);
    const attempted = useRef<string | null>(null);

    const rounds = event?.rounds ?? [];
    const latest = rounds.length > 0 ? rounds[rounds.length - 1] : null;
    // The server applies the same gates; re-checking them here keeps the
    // steady state (every round advanced the moment it was decided) at zero
    // mutation calls rather than one per event view.
    const stuck =
        enabled &&
        event != null &&
        areRoundsRunning(event.status) &&
        latest !== null &&
        isRoundComplete(latest);
    const key = `${eventId}:${event?.currentRound ?? "-"}:${rounds.length}`;

    useEffect(() => {
        if (!stuck) return;
        if (attempted.current === key) return;
        attempted.current = key;
        // `Promise.resolve` rather than a bare `.catch`: a failed recovery
        // must never take the event page down with it — the page renders
        // correctly, it is only stuck — and that has to hold even when the
        // mutation handle isn't a real promise (a thin `useMutation` stub in a
        // component test threw a TypeError straight out of this effect).
        void Promise.resolve(nudge({ eventId })).catch((err) => {
            console.error("nudgeEventRounds failed", err);
        });
    }, [stuck, key, eventId, nudge]);
}
