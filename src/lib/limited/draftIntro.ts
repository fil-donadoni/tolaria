import type { LimitedEventView } from "~/hooks/useLimitedEvent";

/** The Draft's table intro is running: started, a `draftStartsAt` stamped by
 *  the server, round 0 not dealt yet (issue #9167). */
export function isDraftIntroRunning(
    event: Pick<LimitedEventView, "type" | "draftStartsAt" | "draftRound">
): boolean {
    return (
        event.type === "draft" &&
        event.draftStartsAt !== undefined &&
        event.draftRound === undefined
    );
}

/** Whole seconds left on the intro, never negative. */
export function introSecondsLeft(startsAt: number, now: number): number {
    return Math.max(0, Math.ceil((startsAt - now) / 1000));
}
