import { useEffect, useRef, useState } from "react";
import type { PendingChoice } from "~/types/game";
import { revealDurationMs } from "~/lib/random-reveal-pacing";

/** Keeps a VIEWER's Random Reveal alive after the engine removed its pending
 *  choice (CR 705.2 / ADR 0023, issue #5516). When the Bot is the flipper its
 *  ack lands the moment its pacing-table wait ends; the human's overlay would
 *  unmount with the choice. This hook remembers the last non-flipper reveal
 *  and returns it until the reveal's full pacing-table duration (measured from
 *  first sight) has elapsed, then returns `null` — the overlay closes by
 *  itself. The flipper's own client is untouched: it acks when its animation
 *  ends. Client-only, never persisted. */
export function useLingeringRandomReveal(
    head: PendingChoice | undefined,
    viewerId: string
): PendingChoice | null {
    const [held, setHeld] = useState<PendingChoice | null>(null);
    const startedAt = useRef<{ choiceId: string; at: number } | null>(null);

    const watchedReveal =
        head?.kind === "random-reveal" && head.playerId !== viewerId
            ? head
            : null;
    // Render-phase derived state: remember the viewer's reveal while it is the
    // head; drop the memory once a different choice takes the head.
    if (watchedReveal && held?.choiceId !== watchedReveal.choiceId) {
        setHeld(watchedReveal);
    } else if (head && !watchedReveal && held) {
        setHeld(null);
    }

    useEffect(() => {
        if (watchedReveal) {
            if (startedAt.current?.choiceId !== watchedReveal.choiceId) {
                startedAt.current = {
                    choiceId: watchedReveal.choiceId,
                    at: Date.now(),
                };
            }
            return;
        }
        if (head || !held) return;
        const start =
            startedAt.current?.choiceId === held.choiceId
                ? startedAt.current.at
                : 0;
        const remaining = Math.max(
            0,
            revealDurationMs() - (Date.now() - start)
        );
        const timer = window.setTimeout(() => setHeld(null), remaining);
        return () => window.clearTimeout(timer);
    }, [head, held, watchedReveal]);

    return head ? null : held;
}
