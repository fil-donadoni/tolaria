// Live progress for `check:ui` (issue #6072): the heartbeat and per-cell lines
// that keep a 40-minute walk from being indistinguishable from a stall. Pure
// line builders and a timer lifecycle over an injected timer — no browser.
import { describe, expect, it } from "vitest";
import {
    cellProgressLine,
    formatElapsed,
    heartbeatLine,
    startHeartbeat,
    type HeartbeatTimer,
} from "../ui-gate/heartbeat";

describe("heartbeatLine — what a silent walk is doing right now", () => {
    const base = {
        nowMs: 750_000,
        startedAtMs: 0,
        cellsDone: 48,
        cellsTotal: 155,
        load: 5.12,
        stallAfterMs: 90_000,
    };

    it("names elapsed time, cells over the matrix, each open viewport's surface and the load", () => {
        expect(
            heartbeatLine({
                ...base,
                open: [
                    [
                        "1440x900x2",
                        { doing: "dlg-mana-choice", sinceMs: 708_000 },
                    ],
                ],
            })
        ).toBe(
            "ui-gate: ♥ 12m30s · 48/155 cells · 1440x900x2 dlg-mana-choice 42s · load 5.1"
        );
    });

    it("flags an activity held past the stall threshold, before the cell deadline fires", () => {
        const line = heartbeatLine({
            ...base,
            open: [
                ["390x844x3", { doing: "dlg-convoke", sinceMs: 600_000 }],
                ["1440x900x2", { doing: "signing in", sinceMs: 740_000 }],
            ],
        });
        expect(line).toContain("390x844x3 dlg-convoke 2m30s STALL? past 1m30s");
        expect(line).toContain("1440x900x2 signing in 10s · load");
        expect(line.match(/STALL\?/g)).toHaveLength(1);
    });

    it("says so when no viewport is open (between the pool's slots)", () => {
        expect(heartbeatLine({ ...base, open: [] })).toContain(
            "no viewport open"
        );
    });
});

describe("cellProgressLine — one live line per finished cell", () => {
    it("carries its index over the matrix total, the cell and its outcome", () => {
        expect(
            cellProgressLine({
                index: 17,
                total: 155,
                viewport: "390x844x3",
                surface: "dlg-convoke",
                outcome: "measured",
                ms: 21_400,
            })
        ).toBe("ui-gate: [17/155] 390x844x3 dlg-convoke measured 21s");
    });
});

describe("formatElapsed", () => {
    it("renders seconds, minutes and hours", () => {
        expect(formatElapsed(0)).toBe("0s");
        expect(formatElapsed(59_999)).toBe("59s");
        expect(formatElapsed(65_000)).toBe("1m05s");
        expect(formatElapsed(3_725_000)).toBe("1h02m05s");
    });
});

describe("startHeartbeat — a progress line never outlives the walk or fails it", () => {
    function fakeTimer() {
        const live = new Map<number, () => void>();
        let next = 1;
        const unrefd: number[] = [];
        const timer: HeartbeatTimer = {
            setInterval: (fn) => {
                const id = next++;
                live.set(id, fn);
                return {
                    id,
                    unref: () => unrefd.push(id),
                };
            },
            clearInterval: (handle) => {
                live.delete((handle as { id: number }).id);
            },
        };
        const tick = () => [...live.values()].forEach((fn) => fn());
        return { timer, live, tick, unrefd };
    }

    it("beats on every tick until stopped, then never again", () => {
        const { timer, live, tick, unrefd } = fakeTimer();
        let beats = 0;
        const stop = startHeartbeat(30_000, () => beats++, timer);
        tick();
        tick();
        expect(beats).toBe(2);
        expect(unrefd).toEqual([1]);
        stop();
        expect(live.size).toBe(0);
        tick();
        expect(beats).toBe(2);
        stop(); // idempotent
    });

    it("swallows a beat that throws — the walk is never failed by its progress line", () => {
        const { timer, tick } = fakeTimer();
        const stop = startHeartbeat(
            30_000,
            () => {
                throw new Error("stdout closed");
            },
            timer
        );
        expect(() => tick()).not.toThrow();
        stop();
    });
});
