// Is a failed Convex query execution worth retrying, or is it a real defect?
// (issue #3266)
//
// Convex enforces a fixed 1s execution ceiling on every query and mutation —
// not a configurable budget. When the machine running the backend is saturated
// (a heavy gate, a self-play ladder, a compaction burst), a query that normally
// runs in single-digit milliseconds can still blow that ceiling: `getGameTick`
// is ONE indexed row lookup and it was observed timing out. The failure says
// nothing about the query and everything about the machine, so the right
// response is to run it again — not to tear the board down.
//
// A developer error (a throw inside the handler, an argument validator
// rejection, an auth refusal) is the opposite: every retry produces the same
// failure, so it escalates to the error surface on the first occurrence rather
// than making the player wait out a backoff ladder for a verdict that cannot
// change.

/** Substrings of a Convex client error message that mean "the execution was
 *  interrupted", never "this call is wrong". Matched case-insensitively
 *  against the whole message, which the client prefixes with
 *  `[CONVEX Q(game:getPublicState)]` before the server's own text. */
const TRANSIENT_PATTERNS = [
    // The platform ceiling itself: "Function execution timed out (maximum
    // duration: 1s)". Both halves appear in the observed message; either alone
    // is enough, since a future wording change is more likely to keep one.
    "execution timed out",
    "maximum duration",
    // Transport-level interruptions. The socket dropping mid-execution
    // surfaces here rather than through `useConvexConnectionState` when a
    // single query is in flight.
    "fetch failed",
    "network error",
    "connection closed",
    "websocket closed",
    // Backend admission control under load — the same "come back in a moment"
    // class as the ceiling.
    "overloaded",
    "too many concurrent",
] as const;

/** True when `error` is a failed EXECUTION worth running again, false when it
 *  is a defect that will fail identically on every retry. Unknown / non-Error
 *  values are NOT transient: an error nobody can classify is escalated, so a
 *  new failure mode is seen rather than silently retried forever. */
export function isTransientQueryError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return TRANSIENT_PATTERNS.some((pattern) => message.includes(pattern));
}

/** Backoff before retry number `attempt` (0-based): 250ms, 500ms, 1s, 2s.
 *  Bounded — the last rung is the ceiling, and the retry BUDGET
 *  (`MAX_TRANSIENT_RETRIES`) is what ends the ladder, not the delay growing
 *  without limit. */
export function retryDelayMs(attempt: number): number {
    return Math.min(250 * 2 ** Math.max(0, attempt), 2000);
}

/** Consecutive transient failures tolerated before the error surface takes
 *  over. Four rungs spans ~3.75s of backoff, which covers the contention
 *  bursts observed in issue #3266 without leaving a genuinely dead
 *  subscription spinning forever. */
export const MAX_TRANSIENT_RETRIES = 4;
