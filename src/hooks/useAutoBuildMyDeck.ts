import { useCallback, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { AutoBuiltDeck } from "@convex/limited/autoBuild";

/** The viewer's Auto-Build (issue #9976): a one-shot read of
 *  `autoBuildMyLimitedDeck`, fired by the builder's button rather than
 *  subscribed — a suggestion is asked for, never pushed. The server derives the
 *  seat and runs the builder (ADR 0074); this only carries the answer back.
 *  `run` resolves `null` when there is nothing to build (Pool not final, no
 *  Seat) or the call failed (`error` says so). */
export function useAutoBuildMyDeck(eventId: Id<"limitedEvents"> | undefined) {
    const convex = useConvex();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = useCallback(async (): Promise<AutoBuiltDeck | null> => {
        if (eventId === undefined) return null;
        setPending(true);
        setError(null);
        try {
            const deck = await convex.query(
                api.limitedEvents.autoBuildMyLimitedDeck,
                { eventId }
            );
            if (deck === null) setError("Auto-Build is not available yet.");
            return deck as AutoBuiltDeck | null;
        } catch {
            setError("Auto-Build failed. Try again.");
            return null;
        } finally {
            setPending(false);
        }
    }, [convex, eventId]);

    return { run, pending, error };
}
