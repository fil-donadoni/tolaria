// A Brain consult ALWAYS settles (issue #2284, review finding 1).
//
// `consultBrain` had no timeout of its own. A Worker that never replies — a
// wedged search, a message lost across a tab suspend — therefore left the
// driver's in-flight guard set forever, and an in-flight guard the driver
// cannot clear is a latch its watchdog cannot walk past: `escalate` will not
// interleave a rung into a live submission (ADR 0091 decision 6, a realisation
// is atomic). The game froze with no `BotStuckNotice` and no escalation record.
//
// The timeout turns "never replies" into the ordinary `move: null` outcome the
// escalation ladder already handles — the same answer `worker.onerror` has
// always resolved.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import { DIFFICULTY_BUDGETS } from "@convex/gre/difficulty";
import { BOT_WATCHDOG_MS } from "~/hooks/useVsAiDriver";
import {
    consultBrain,
    disposeBrain,
    BRAIN_CONSULT_TIMEOUT_MS,
} from "../brain-client";

/** A Worker that accepts the request and never answers — the wedged search. */
class SilentWorker {
    onmessage: unknown = null;
    onerror: unknown = null;
    postMessage() {}
    terminate() {}
}

const originalWorker = globalThis.Worker;

beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { Worker?: unknown }).Worker =
        SilentWorker as unknown as typeof Worker;
});

afterEach(() => {
    disposeBrain();
    (globalThis as { Worker?: unknown }).Worker = originalWorker;
    vi.useRealTimers();
});

describe("consultBrain always settles (issue #2284)", () => {
    it("resolves to no move when the Worker never replies", async () => {
        const promise = consultBrain({} as unknown as PublicGameState, "u1-p2");

        // Nothing yet: a legitimate search is still allowed to think.
        let settled = false;
        void promise.then(() => {
            settled = true;
        });
        await vi.advanceTimersByTimeAsync(BRAIN_CONSULT_TIMEOUT_MS - 1);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(2);
        await expect(promise).resolves.toEqual({ move: null, trace: null });
    });

    it("sits between the hardest search budget and the watchdog deadline", () => {
        // Above the budget, so a legitimately slow think is never cut short…
        const hardest = Math.max(
            ...Object.values(DIFFICULTY_BUDGETS).map((b) => b.timeMs ?? 0)
        );
        expect(BRAIN_CONSULT_TIMEOUT_MS).toBeGreaterThan(hardest * 5);
        // …and below the watchdog, so a wedged consult has released the driver's
        // in-flight guard by the time the first escalation deadline arrives.
        expect(BRAIN_CONSULT_TIMEOUT_MS).toBeLessThan(BOT_WATCHDOG_MS);
    });
});
