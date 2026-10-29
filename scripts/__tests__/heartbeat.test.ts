import { describe, expect, it } from "vitest";
import {
    AFK_DISPATCH_STALE_MS,
    clockDue,
    HEALTH_GATE_STALE_MS,
    HEARTBEAT_DEAD_MS,
    healthGateDue,
    heartbeatLines,
    tick,
    type HealthFacts,
    type HeartbeatDeps,
} from "../lib/heartbeat";

/**
 * The fallback clock's staleness rule (issue #7445): GitHub drops most
 * `schedule` runs, so the heartbeat dispatches a workflow whose newest run is
 * older than its period — and nothing while a newer one exists.
 */
const NOW = Date.parse("2026-10-29T09:00:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const done = (msAgo: number) => ({ createdAt: at(msAgo), status: "completed" });

describe("clockDue — the staleness rule (issue #7445)", () => {
    it("a newest run older than the threshold → dispatch", () => {
        const d = clockDue(
            { active: true, runs: [done(AFK_DISPATCH_STALE_MS + 60_000)] },
            NOW,
            AFK_DISPATCH_STALE_MS
        );
        expect(d.fire).toBe(true);
    });

    it("a newest run younger than the threshold → nothing", () => {
        const d = clockDue(
            {
                active: true,
                runs: [
                    done(5 * 60 * 60 * 1000),
                    done(AFK_DISPATCH_STALE_MS - 60_000),
                ],
            },
            NOW,
            AFK_DISPATCH_STALE_MS
        );
        expect(d.fire).toBe(false);
    });

    it("a queued or running run → nothing, however old the last one", () => {
        const d = clockDue(
            {
                active: true,
                runs: [
                    done(5 * 60 * 60 * 1000),
                    { createdAt: at(4 * 60 * 60 * 1000), status: "queued" },
                ],
            },
            NOW,
            AFK_DISPATCH_STALE_MS
        );
        expect(d.fire).toBe(false);
    });

    it("a disabled workflow (the kill switch) is never dispatched", () => {
        const d = clockDue(
            { active: false, runs: [done(24 * 60 * 60 * 1000)] },
            NOW,
            AFK_DISPATCH_STALE_MS
        );
        expect(d.fire).toBe(false);
    });

    it("no run on record → dispatch", () => {
        expect(clockDue({ active: true, runs: [] }, NOW, 1).fire).toBe(true);
    });
});

describe("healthGateDue — a tip without a verdict (issue #7445)", () => {
    const stale: HealthFacts = {
        active: true,
        runs: [done(HEALTH_GATE_STALE_MS + 60_000)],
        tip: "abcdef12",
        tipHasVerdict: false,
        pivotInFlight: false,
    };

    it("no verdict, nothing in flight, stale clock → dispatch the gate", () => {
        expect(healthGateDue(stale, NOW).fire).toBe(true);
    });

    it("a fresh health run → nothing", () => {
        expect(
            healthGateDue(
                { ...stale, runs: [done(HEALTH_GATE_STALE_MS - 60_000)] },
                NOW
            ).fire
        ).toBe(false);
    });

    it("the tip already has a verdict → nothing", () => {
        expect(healthGateDue({ ...stale, tipHasVerdict: true }, NOW).fire).toBe(
            false
        );
    });

    it("a run on the pivot → nothing", () => {
        expect(healthGateDue({ ...stale, pivotInFlight: true }, NOW).fire).toBe(
            false
        );
    });
});

describe("tick — reads, then dispatches only what is due", () => {
    const deps = (over: Partial<HeartbeatDeps> = {}) => {
        const fired: string[] = [];
        const d: HeartbeatDeps = {
            host: "mac",
            now: () => NOW,
            afkDispatchClock: () => ({
                active: true,
                runs: [done(AFK_DISPATCH_STALE_MS + 1)],
            }),
            healthFacts: () => ({
                active: true,
                runs: [done(60_000)],
                tip: "abcdef12",
                tipHasVerdict: false,
                pivotInFlight: false,
            }),
            dispatchAfk: () => void fired.push("afk"),
            dispatchHealthGate: () => void fired.push("health"),
            ...over,
        };
        return { d, fired };
    };

    it("dispatches the stale clock, leaves the fresh one", () => {
        const { d, fired } = deps();
        const s = tick(d);
        expect(fired).toEqual(["afk"]);
        expect(s.afkDispatch.dispatched).toBe(true);
        expect(s.health.dispatched).toBeUndefined();
    });

    it("an unreadable fact dispatches nothing and records the error", () => {
        const { d, fired } = deps({
            afkDispatchClock: () => {
                throw new Error("gh: HTTP 502");
            },
        });
        const s = tick(d);
        expect(fired).toEqual([]);
        expect(s.afkDispatch.error).toBe("gh: HTTP 502");
    });

    it("--dry-run decides but dispatches nothing", () => {
        const { d, fired } = deps({ dryRun: true });
        expect(tick(d).afkDispatch.fire).toBe(true);
        expect(fired).toEqual([]);
    });
});

describe("heartbeatLines — a dead heartbeat is visible", () => {
    const state = (msAgo: number) =>
        JSON.stringify({
            at: at(msAgo),
            host: "mac",
            afkDispatch: { fire: false, reason: "last run 3 min ago" },
            health: { fire: false, reason: "tip abcdef12 has a verdict" },
        });

    it("a recent tick reads alive", () => {
        expect(heartbeatLines(state(60_000), NOW)[0]).not.toMatch(/DEAD/);
    });

    it("a tick older than three periods reads DEAD", () => {
        expect(heartbeatLines(state(HEARTBEAT_DEAD_MS), NOW)[0]).toMatch(
            /DEAD/
        );
    });

    it("no state file says it never fired", () => {
        expect(heartbeatLines(null, NOW)[0]).toMatch(/never fired/);
    });
});
