/**
 * Live progress for `check:ui` (issue #6072): a heartbeat line on a fixed
 * cadence and one line per finished cell.
 *
 * WHY. The cell lines are buffered per viewport (`walkViewport` in
 * `index.ts`) so five parallel viewports never interleave, and the only live
 * line used to be `<viewport> — walked`, printed when a whole viewport
 * finished. On 2026-10-19 a SCOPED run of 31 surfaces, capped to one viewport
 * at a time by a foreign heavy gate, printed nothing for 41+ minutes: neither
 * the session nor the owner could tell a slow walk from a stall, which
 * surface was running, or how far it had got — while the run held the UI lane
 * every other session waits on.
 *
 * DIAGNOSTIC ONLY. Nothing here lands in the verdict block `land` re-derives
 * (`verify-receipt.ts`): these lines are printed live, before the receipt, and
 * a receipt reader skips them like the `— walked` lines they sit beside.
 *
 * Pure: the clock, the load and the timer functions are injected.
 */

/** What one viewport is doing now, and since when. */
export interface ViewportActivity {
    doing: string;
    sinceMs: number;
}

export interface HeartbeatInput {
    nowMs: number;
    startedAtMs: number;
    cellsDone: number;
    cellsTotal: number;
    /** The viewports still open, in matrix order. */
    open: readonly (readonly [string, ViewportActivity])[];
    load: number;
    /** The deployment watch's state (`probeStateLabel`, issue #6081), printed
     *  before the load; absent when the run has no watch. */
    convex?: string;
    /** One activity older than this is flagged as a likely stall. */
    stallAfterMs: number;
}

/** `1h02m05s` / `12m30s` / `42s`. */
export function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, "0");
    if (h > 0) return `${h}h${String(m).padStart(2, "0")}m${ss}s`;
    if (m > 0) return `${m}m${ss}s`;
    return `${s}s`;
}

/**
 * One heartbeat: elapsed, cells done over the matrix, what each open viewport
 * is on and for how long, the deployment probe's state, the load. A viewport whose current activity is older
 * than `stallAfterMs` says so, so a stall is named before the cell deadline
 * fires rather than only after.
 */
export function heartbeatLine(input: HeartbeatInput): string {
    const parts = [
        `ui-gate: ♥ ${formatElapsed(input.nowMs - input.startedAtMs)}`,
        `${input.cellsDone}/${input.cellsTotal} cells`,
    ];
    if (input.open.length === 0) parts.push("no viewport open");
    for (const [viewport, activity] of input.open) {
        const held = input.nowMs - activity.sinceMs;
        const stall =
            held > input.stallAfterMs
                ? ` STALL? past ${formatElapsed(input.stallAfterMs)}`
                : "";
        parts.push(
            `${viewport} ${activity.doing} ${formatElapsed(held)}${stall}`
        );
    }
    if (input.convex) parts.push(input.convex);
    parts.push(`load ${input.load.toFixed(1)}`);
    return parts.join(" · ");
}

/** The live line of one finished cell: `[17/155] 390x844x3 dlg-convoke measured 21s`. */
export function cellProgressLine(input: {
    index: number;
    total: number;
    viewport: string;
    surface: string;
    outcome: string;
    ms: number;
}): string {
    return `ui-gate: [${input.index}/${input.total}] ${input.viewport} ${input.surface} ${input.outcome} ${formatElapsed(input.ms)}`;
}

export interface HeartbeatTimer {
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
}

/**
 * Call `beat` every `intervalMs` until the returned stop is called. The
 * caller stops it in a `finally`, so a deadline or a thrown error never leaves
 * the timer running. A `beat` that throws is swallowed: a progress line must
 * never fail a gate. Idempotent stop.
 */
export function startHeartbeat(
    intervalMs: number,
    beat: () => void,
    timer: HeartbeatTimer
): () => void {
    const handle = timer.setInterval(() => {
        try {
            beat();
        } catch {
            // diagnostic only
        }
    }, intervalMs);
    // Never the thing that keeps the process alive.
    (handle as { unref?: () => void } | null)?.unref?.();
    let stopped = false;
    return () => {
        if (stopped) return;
        stopped = true;
        timer.clearInterval(handle);
    };
}
