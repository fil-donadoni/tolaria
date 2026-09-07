import { useEffect, useSyncExternalStore } from "react";
import type { NowPayload } from "./nowPayload";

/**
 * The Now view's TRANSPORT (PRD #3148 S2), ported from
 * `scripts/dashboard/now-loop-status.js` (#2519/#2625/#3135).
 *
 * What is here is only what is impure: the fetch, the poll timer and the
 * snapshot every Now component reads. The COMPOSITION is the component tree —
 * one payload, one composition, exactly as before.
 *
 * A STORE, not component state, for one reason that survives the port: the
 * keyboard layer's `r` shortcut refreshes the visible view without going
 * through React (`dashboard/lib/shortcuts.ts`), and a second copy of "the
 * current payload" is the thing that disagrees with the first.
 *
 * ── WHAT REPLACED `writeBodyPreservingFocus` ──────────────────────────────
 *
 * The vanilla transport rewrote `#loop-status-body`'s `innerHTML` wholesale
 * every ten seconds, which moved `document.activeElement` back to `<body>` six
 * times a minute — a light was keyboard-REACHABLE but not keyboard-OPERABLE
 * (PR #2837 review, finding 1). `nowControlKey` existed to re-find the control
 * the operator had focused and give the focus ring back.
 *
 * None of that is needed here, and its absence is not an omission: React
 * reconciles, so a poll that changes a number PATCHES the text node and leaves
 * the `<button>` element itself — and therefore the focus — untouched. What
 * takes `nowControlKey`'s place is the KEY: every list below renders with a
 * stable identity (`data-pass`, `issue`, `session`, the hour start), so a
 * re-ordered or re-sized list still matches elements to elements rather than
 * remounting them. `NowView.test.tsx` proves focus survives a refresh, which
 * is the assertion that used to guard the manual restore.
 *
 * DATA BOUNDARY: this module and everything it imports touch `/api/loop-status`,
 * `/api/activity` and `/api/live` and nothing else. No History module may be
 * reachable from here — `telemetry-serve.test.ts` crawls the React graph and
 * asserts it.
 */

export interface LoopStatusSnapshot {
    /** The payload, or `null` before the first successful poll. */
    data: NowPayload | null;
    /** Set when `/api/loop-status` itself failed — the card's subtitle says
     *  so, and nothing below it is drawn from a payload that never arrived. */
    error: string | null;
    /** The clock the render was composed against. Stamped once per refresh
     *  rather than read at each render site: two sections computing "now"
     *  a millisecond apart is how a timeline and a table come to disagree
     *  about the same claim's age, and it is what makes the rendering
     *  testable at all. */
    nowMs: number;
}

let snapshot: LoopStatusSnapshot = { data: null, error: null, nowMs: 0 };

const listeners = new Set<() => void>();

function publish(next: LoopStatusSnapshot): void {
    snapshot = next;
    for (const fn of listeners) fn();
}

export const getLoopStatus = (): LoopStatusSnapshot => snapshot;

export function subscribeToLoopStatus(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
    };
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
    const res = await fetch(url);
    const body = (await res.json()) as Record<string, unknown> & {
        error?: string;
    };
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
}

const messageOf = (e: unknown): string =>
    e instanceof Error ? e.message : String(e);

/** Monotonic per call — a response from an older call than the newest one in
 *  flight is dropped, so a slow `gh`-backed poll can never paint over a
 *  fresher one (review of PR #3136). */
let refreshSeq = 0;

/**
 * One poll. `/api/loop-status` first (it decides which issues the live read
 * asks about), then `/api/activity` and `/api/live` in PARALLEL — each with
 * its own `*Error` sibling on failure, the fail-closed shape every read on
 * this page uses. A failed live read never takes the loop status down with it.
 */
export async function refreshLoopStatus(): Promise<void> {
    const seq = ++refreshSeq;
    let data: NowPayload;
    try {
        data = (await fetchJson("/api/loop-status")) as unknown as NowPayload;
    } catch (e) {
        if (seq !== refreshSeq) return;
        publish({ ...snapshot, error: messageOf(e) });
        return;
    }
    const issues = (data.claims ?? []).map((c) => c.issue).join(",");
    const [activity, live] = await Promise.allSettled([
        fetchJson("/api/activity"),
        fetchJson(`/api/live${issues ? `?issues=${issues}` : ""}`),
    ]);
    if (activity.status === "fulfilled") {
        data.activity = activity.value as unknown as NowPayload["activity"];
    } else {
        data.activityError = messageOf(activity.reason);
    }
    if (live.status === "fulfilled") {
        data.live = live.value as unknown as NowPayload["live"];
    } else {
        data.liveError = messageOf(live.reason);
    }
    if (seq !== refreshSeq) return;
    publish({ data, error: null, nowMs: Date.now() });
}

export const LOOP_STATUS_POLL_MS = 10_000;

let timer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;
let onVisible: (() => void) | null = null;

/**
 * Start polling, and return the stop function. REFCOUNTED and idempotent: the
 * view mounts it from an effect, and a second mount (React 19 StrictMode
 * double-invokes effects in development) must not open a second timer.
 */
export function startLoopStatusPolling(): () => void {
    subscribers += 1;
    if (subscribers === 1) {
        void refreshLoopStatus();
        timer = setInterval(() => {
            // A forgotten background tab must not poll `gh` forever.
            if (document.visibilityState === "visible")
                void refreshLoopStatus();
        }, LOOP_STATUS_POLL_MS);
        onVisible = () => {
            if (document.visibilityState === "visible")
                void refreshLoopStatus();
        };
        document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
        subscribers -= 1;
        if (subscribers > 0) return;
        if (timer) clearInterval(timer);
        timer = null;
        if (onVisible)
            document.removeEventListener("visibilitychange", onVisible);
        onVisible = null;
    };
}

/** The snapshot, with the poll running for as long as the caller is mounted. */
export function useLoopStatus(): LoopStatusSnapshot {
    const state = useSyncExternalStore(subscribeToLoopStatus, getLoopStatus);
    useEffect(() => startLoopStatusPolling(), []);
    return state;
}

/** Test-only: drop every latch, so a suite that swapped `fetch` or the
 *  document does not inherit the previous file's timer or payload. */
export function resetLoopStatus(): void {
    if (timer) clearInterval(timer);
    if (onVisible) document.removeEventListener("visibilitychange", onVisible);
    timer = null;
    onVisible = null;
    subscribers = 0;
    refreshSeq = 0;
    snapshot = { data: null, error: null, nowMs: 0 };
    listeners.clear();
}
