/**
 * The Bot-play replay's cadence (issue #7925): a
 * push-triggered replay sweeps at most once per `botReplay.minIntervalMinutes`,
 * the nightly / a dispatch / a by-hand run always sweep, and a
 * `bot-hash` lag counts only from a push past the interval.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    DEFAULT_MIN_INTERVAL_MINUTES,
    botReplayCadence,
    botHashLateSinceMs,
    parseBotReplayConfig,
} from "../lib/bot-replay-cadence";

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

describe("botReplayCadence — a push sweeps at most once per interval (issue #7925)", () => {
    it("a push inside the interval is throttled, naming when the next sweep is due", () => {
        expect(
            botReplayCadence({
                event: "push",
                lastSweepAtMs: NOW - 90 * MIN,
                nowMs: NOW,
                minIntervalMinutes: 240,
            })
        ).toEqual({
            kind: "throttled",
            lastSweepAtMs: NOW - 90 * MIN,
            nextDueAtMs: NOW + 150 * MIN,
        });
    });

    it("a push once the interval has passed sweeps — the boundary included", () => {
        for (const age of [240, 241, 600]) {
            expect(
                botReplayCadence({
                    event: "push",
                    lastSweepAtMs: NOW - age * MIN,
                    nowMs: NOW,
                    minIntervalMinutes: 240,
                }).kind
            ).toBe("due");
        }
    });

    it("the nightly, a dispatch and a by-hand run always sweep, however recent the last sweep", () => {
        for (const event of ["schedule", "workflow_dispatch", undefined]) {
            expect(
                botReplayCadence({
                    event,
                    lastSweepAtMs: NOW - MIN,
                    nowMs: NOW,
                    minIntervalMinutes: 240,
                }).kind
            ).toBe("due");
        }
    });

    it("a push with no whole sweep on the history sweeps", () => {
        expect(
            botReplayCadence({
                event: "push",
                lastSweepAtMs: null,
                nowMs: NOW,
                minIntervalMinutes: 240,
            }).kind
        ).toBe("due");
    });

    it("an interval of 0 restores one sweep per push", () => {
        expect(
            botReplayCadence({
                event: "push",
                lastSweepAtMs: NOW,
                nowMs: NOW,
                minIntervalMinutes: 0,
            }).kind
        ).toBe("due");
    });
});

describe("botHashLateSinceMs — a held-back replay is late only once a push asked past the interval", () => {
    const due = NOW;
    it("a move inside the interval is late from the first commit at or after the due time", () => {
        expect(
            botHashLateSinceMs({
                movedAtMs: due - 200 * MIN,
                dueAtMs: due,
                firstCommitAtOrAfterDueMs: due + 30 * MIN,
            })
        ).toBe(due + 30 * MIN);
    });

    it("with no commit past the due time it is not late — a quiet base waits for the nightly unfiled", () => {
        expect(
            botHashLateSinceMs({
                movedAtMs: due - 200 * MIN,
                dueAtMs: due,
                firstCommitAtOrAfterDueMs: null,
            })
        ).toBeNull();
    });

    it("a move after the due time, or with no whole sweep on the history, is late from the move", () => {
        expect(
            botHashLateSinceMs({
                movedAtMs: due + 5 * MIN,
                dueAtMs: due,
                firstCommitAtOrAfterDueMs: due + 5 * MIN,
            })
        ).toBe(due + 5 * MIN);
        expect(
            botHashLateSinceMs({
                movedAtMs: due - 5 * MIN,
                dueAtMs: null,
                firstCommitAtOrAfterDueMs: null,
            })
        ).toBe(due - 5 * MIN);
    });
});

describe("parseBotReplayConfig — tolaria.config.json `botReplay`", () => {
    it("reads minIntervalMinutes; a missing or malformed value is the default", () => {
        expect(
            parseBotReplayConfig({ botReplay: { minIntervalMinutes: 90 } })
        ).toEqual({ minIntervalMinutes: 90 });
        for (const raw of [
            null,
            {},
            { botReplay: {} },
            { botReplay: { minIntervalMinutes: -1 } },
            { botReplay: { minIntervalMinutes: "240" } },
        ]) {
            expect(parseBotReplayConfig(raw)).toEqual({
                minIntervalMinutes: DEFAULT_MIN_INTERVAL_MINUTES,
            });
        }
    });

    it("the checked-in config sets it, and its $comment documents it", () => {
        const raw = JSON.parse(
            readFileSync(
                join(__dirname, "..", "..", "tolaria.config.json"),
                "utf8"
            )
        ) as { $comment: string; botReplay?: { minIntervalMinutes?: number } };
        expect(raw.botReplay?.minIntervalMinutes).toBe(240);
        expect(raw.$comment).toContain("`botReplay.minIntervalMinutes`");
    });
});
