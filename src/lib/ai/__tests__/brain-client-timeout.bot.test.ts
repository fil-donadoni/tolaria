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

/** A Worker that answers with whatever `reply` builds from the request — the
 *  healthy path and the search-threw path (issue #2470). */
let reply: (req: { id: number }) => unknown = (req) => ({
    id: req.id,
    move: null,
    trace: null,
});
class ReplyingWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: unknown = null;
    postMessage(req: { id: number }) {
        this.onmessage?.({ data: reply(req) });
    }
    terminate() {}
}

/** A Worker that fails outright — `onerror`, the path that used to discard the
 *  reason and resolve every pending consult to a bare "no move". */
class FailingWorker {
    onmessage: unknown = null;
    onerror: ((e: unknown) => void) | null = null;
    postMessage() {
        this.onerror?.({ message: "Script error" });
    }
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
        await expect(promise).resolves.toEqual({
            move: null,
            trace: null,
            outcome: "timeout",
            via: "worker",
        });
    });

    it("sits between the hardest search budget and the watchdog deadline", () => {
        // Above the budget, so a legitimately slow think is never cut short…
        const hardest = Math.max(
            ...Object.values(DIFFICULTY_BUDGETS).map((b) => b.timeMs ?? 0)
        );
        // A flat 5× margin (the original formula here) was calibrated against
        // the PRE-#2682 `hard.timeMs = 600`; a literal `hardest * 5` at
        // today's scale (`hard` = 3000, issue #2682) would demand a 15s+
        // consult timeout — worse for the player, since a genuinely wedged
        // Worker would then take 15s+ to surface instead of 5s, not safer.
        // What the margin actually protects is unchanged: enough slack that a
        // legitimately slow `hard` think is never mistaken for a wedge. 1s of
        // headroom above the hardest real budget is that slack.
        expect(BRAIN_CONSULT_TIMEOUT_MS).toBeGreaterThan(hardest);
        expect(BRAIN_CONSULT_TIMEOUT_MS - hardest).toBeGreaterThanOrEqual(1000);
        // …and below the watchdog, so a wedged consult has released the driver's
        // in-flight guard by the time the first escalation deadline arrives.
        expect(BRAIN_CONSULT_TIMEOUT_MS).toBeLessThan(BOT_WATCHDOG_MS);
    });
});

// ── The consult's verdict (issue #2470) ─────────────────────────────────────
//
// All four endings below used to resolve the SAME `{ move: null }` the driver
// gets when the bot legitimately has nothing to do. Telling them apart is what
// makes "the bot did nothing all game" answerable from a bug report (#2450).
describe("consultBrain reports HOW the consult ended (issue #2470)", () => {
    it("tags a chosen move", async () => {
        (globalThis as { Worker?: unknown }).Worker =
            ReplyingWorker as unknown as typeof Worker;
        reply = (req) => ({ id: req.id, move: { kind: "pass" }, trace: null });

        await expect(
            consultBrain({} as unknown as PublicGameState, "u1-p2")
        ).resolves.toMatchObject({
            outcome: "move",
            via: "worker",
            move: { kind: "pass" },
        });
    });

    it("tags a healthy search that simply had no move", async () => {
        (globalThis as { Worker?: unknown }).Worker =
            ReplyingWorker as unknown as typeof Worker;
        reply = (req) => ({ id: req.id, move: null, trace: null });

        await expect(
            consultBrain({} as unknown as PublicGameState, "u1-p2")
        ).resolves.toMatchObject({ outcome: "no-move", via: "worker" });
    });

    it("tags a search that THREW, carrying its message", async () => {
        (globalThis as { Worker?: unknown }).Worker =
            ReplyingWorker as unknown as typeof Worker;
        reply = (req) => ({
            id: req.id,
            move: null,
            trace: null,
            error: { name: "Error", message: "Unknown card id" },
        });

        await expect(
            consultBrain({} as unknown as PublicGameState, "u1-p2")
        ).resolves.toMatchObject({
            outcome: "search-error",
            via: "worker",
            message: "Unknown card id",
            move: null,
        });
    });

    it("tags a Worker that failed outright", async () => {
        (globalThis as { Worker?: unknown }).Worker =
            FailingWorker as unknown as typeof Worker;

        await expect(
            consultBrain({} as unknown as PublicGameState, "u1-p2")
        ).resolves.toMatchObject({
            outcome: "worker-error",
            via: "worker",
            message: "Script error",
        });
    });
});
