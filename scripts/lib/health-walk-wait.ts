/**
 * The browser walk's wait for a free heavy-mutex window (issue #5024).
 *
 * Batch health releases its `yield` hold and starts the walk in the same
 * instant a queued `land` takes the heavy mutex, so `check:ui` found a live
 * holder and capped itself at one viewport (issue #4941) for the whole walk:
 * the last seven batch walks ran 1 of 5 three times (1747 / 1783 / 1841 s
 * wall, the capping holder a `land`'s `git rebase`) and 5 of 5 four times
 * (492–631 s). The walk waits, bounded, for a gap — it never takes the mutex
 * (issue #4962) and never reserves the gap, so a `land` is never held up by it.
 *
 * Expiry is not a verdict: the walk starts anyway, capped as before, and the
 * run's outcome is the walk's alone.
 *
 * Builtins only (health-main's import constraint).
 */

/** The longest the walk waits for the heavy mutex to be free. One `land`
 *  holds it ~4 min (rebase → lane gate → merge; the same seven runs' holders
 *  and `gate:who` rows), so 6 min outlasts one `land` with margin without
 *  letting a queue of them stall the verdict past the 90 min stale-run dedup
 *  (`STALE_RUNNING_MS`) — the `running` record is re-stamped at the wait's
 *  start, never aged by it. */
export const WALK_MUTEX_WAIT_MAX_MS = 6 * 60 * 1000;

/** Poll cadence while waiting: a `land` is minutes long, a probe is a file
 *  read. */
export const WALK_MUTEX_WAIT_POLL_MS = 5000;

export interface WalkWaitResult {
    /** Wall time spent waiting; 0 when no holder was live at the start. */
    waitedMs: number;
    /** True when the bound expired with a holder still live. */
    timedOut: boolean;
}

export interface WalkWaitInput {
    /** Names the live heavy holder (`pid N · label`), or null when free. */
    holder: () => string | null;
    announce: (line: string) => void;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    maxMs?: number;
    pollMs?: number;
}

/**
 * Block until `holder()` reads free, or `maxMs` passes. Announces once when
 * the wait begins (holder + bound) and once when it ends (how long it waited
 * and why it stopped), in the style of the gate's mutex-wait lines.
 */
export async function waitForWalkWindow(
    input: WalkWaitInput
): Promise<WalkWaitResult> {
    const now = input.now ?? Date.now;
    const sleep =
        input.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxMs = input.maxMs ?? WALK_MUTEX_WAIT_MAX_MS;
    const pollMs = input.pollMs ?? WALK_MUTEX_WAIT_POLL_MS;

    const first = input.holder();
    if (first === null) return { waitedMs: 0, timedOut: false };

    const startedAt = now();
    input.announce(
        `health-main: walk waits for a free heavy-mutex window — held by ${first} (up to ${Math.round(maxMs / 1000)}s, then walks capped)`
    );
    for (;;) {
        const waitedMs = now() - startedAt;
        if (waitedMs >= maxMs) {
            input.announce(
                `health-main: walk waited ${Math.round(waitedMs / 1000)}s, heavy mutex still held — walking now (capped)`
            );
            return { waitedMs, timedOut: true };
        }
        await sleep(Math.min(pollMs, maxMs - waitedMs));
        if (input.holder() === null) {
            const done = now() - startedAt;
            input.announce(
                `health-main: walk waited ${Math.round(done / 1000)}s — heavy mutex free, walking now`
            );
            return { waitedMs: done, timedOut: false };
        }
    }
}
