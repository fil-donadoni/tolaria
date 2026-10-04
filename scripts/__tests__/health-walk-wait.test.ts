import { describe, expect, it } from "vitest";
import {
    WALK_MUTEX_WAIT_MAX_MS,
    waitForWalkWindow,
} from "../lib/health-walk-wait";

/**
 * The walk waits, bounded, for a free heavy-mutex window (issue #5024).
 * A fake clock and a scripted holder probe: no real sleep, no lock root.
 */
function harness(holders: Array<string | null>) {
    let t = 0;
    let probes = 0;
    const lines: string[] = [];
    return {
        lines,
        probes: () => probes,
        input: {
            holder: () => {
                const h = holders[Math.min(probes, holders.length - 1)];
                probes += 1;
                return h;
            },
            announce: (l: string) => lines.push(l),
            now: () => t,
            sleep: async (ms: number) => {
                t += ms;
            },
            maxMs: 60_000,
            pollMs: 5000,
        },
    };
}

describe("waitForWalkWindow (issue #5024)", () => {
    it("starts at once when no holder is live", async () => {
        const h = harness([null]);
        const r = await waitForWalkWindow(h.input);
        expect(r).toEqual({ waitedMs: 0, timedOut: false });
        expect(h.lines).toEqual([]);
    });

    it("held, then free after N polls: walks after the wait, naming the holder", async () => {
        const held = "pid 4242 · land 5001";
        const h = harness([held, held, held, null]);
        const r = await waitForWalkWindow(h.input);
        expect(r).toEqual({ waitedMs: 15_000, timedOut: false });
        expect(h.lines[0]).toContain(held);
        expect(h.lines[1]).toContain("waited 15s");
        expect(h.lines[1]).toContain("free");
    });

    it("a holder that never releases: walks at the bound, no verdict from the wait", async () => {
        const h = harness(["pid 1 · land 9"]);
        const r = await waitForWalkWindow(h.input);
        expect(r).toEqual({ waitedMs: 60_000, timedOut: true });
        expect(h.lines.at(-1)).toContain("capped");
    });

    it("the bound is about one land, well inside the stale-run dedup", () => {
        expect(WALK_MUTEX_WAIT_MAX_MS).toBe(6 * 60 * 1000);
        expect(WALK_MUTEX_WAIT_MAX_MS).toBeLessThan(90 * 60 * 1000);
    });
});
