import { describe, it, expect } from "vitest";
import {
    parseKernSleeptime,
    readLastSleepAt,
    stepVerdict,
} from "../lib/health-verdict";

/**
 * A gate step cut by system sleep is INFRA, not a RED tip (issue #4938).
 *
 * The RED on a15195d8 was four `test:bot` timeouts, one per worker, each
 * ~900 s — the length of the clamshell sleep `pmset` logged. The tip passed
 * untouched in a repro worktree. These pin the classifier that tells the two
 * apart; the downstream half (no fixer, no release) is in
 * `health-cadence.test.ts` and `release.test.ts`.
 */
const STEP_START = Date.parse("2026-10-01T11:13:16.000Z");

describe("health verdict — a step cut by system sleep (issue #4938)", () => {
    it("is INFRA when the machine entered sleep during the failed step", () => {
        expect(
            stepVerdict({
                ok: false,
                startedAt: STEP_START,
                lastSleepAt: STEP_START + 21_000,
            })
        ).toBe("infra");
    });

    it("is RED when the last sleep predates the step", () => {
        expect(
            stepVerdict({
                ok: false,
                startedAt: STEP_START,
                lastSleepAt: STEP_START - 1,
            })
        ).toBe("red");
    });

    it("is RED when no sleep can be read — the reading only ever downgrades", () => {
        expect(
            stepVerdict({ ok: false, startedAt: STEP_START, lastSleepAt: null })
        ).toBe("red");
    });

    it("is GREEN for a step that passed, whatever the machine did", () => {
        expect(
            stepVerdict({
                ok: true,
                startedAt: STEP_START,
                lastSleepAt: STEP_START + 1,
            })
        ).toBe("green");
    });
});

describe("health verdict — reading kern.sleeptime", () => {
    it("parses sysctl's struct timeval to epoch ms", () => {
        expect(
            parseKernSleeptime(
                "{ sec = 1790866381, usec = 538510 } Thu Oct  1 16:53:01 2026\n"
            )
        ).toBe(1790866381538);
    });

    it("is null for a machine that never slept, or unreadable output", () => {
        expect(parseKernSleeptime("{ sec = 0, usec = 0 }\n")).toBeNull();
        expect(parseKernSleeptime("")).toBeNull();
    });

    it("reads a real past instant on darwin, null elsewhere", () => {
        const at = readLastSleepAt();
        if (process.platform !== "darwin") {
            expect(at).toBeNull();
            return;
        }
        // A machine up since boot without sleeping reads null, also fine.
        if (at !== null) expect(at).toBeLessThanOrEqual(Date.now());
    });
});
