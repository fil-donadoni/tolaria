// Display helpers for the per-player Match Clock (issue #2308). The clock's
// arithmetic lives in `convex/matchClock.ts`; this is only how it reads.

/** Below this a clock reads as urgent. */
export const MATCH_CLOCK_URGENT_MS = 60_000;

/** `m:ss` (or `h:mm:ss` from an hour up), rounded UP to the second so a clock
 *  shows `0:00` only once it has truly run out. */
export function formatClock(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, "0");
    if (hours > 0)
        return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
    return `${minutes}:${seconds}`;
}
