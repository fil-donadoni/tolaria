import { describe, it, expect } from "vitest";
import {
    classifyLandFailure,
    landLogMerged,
    parseDetachLine,
    parseDuration,
} from "../lib/workflow-logs";

/**
 * The workflow's log lines (issue #4968) — the pure half. The database half
 * (ingest, rotation, the attempt history) is `telemetry-ingest-quick.test.ts`.
 */

describe("classifyLandFailure — the stage a non-green land stopped in", () => {
    // Shapes copied from real `~/.cache/tolaria/gate-runs/land-*/log` files.
    it("charges a stopped rebase to `rebase`", () => {
        const log = [
            "[gate] acquired the heavy mutex after 7s",
            "Could not apply f6b3f12... # Bot: refit (issue #4900)",
            "convex/gre/ai/evalWeights.ts",
            'error: script "land" exited with code 1',
        ].join("\n");
        expect(classifyLandFailure(log)).toBe("rebase");
    });

    it("charges a failed vitest project in the lane to `vitest`", () => {
        const log = [
            "lane: ran",
            " FAIL  |node-engine| scripts/__tests__/x.test.ts > y",
            "  ✗ check:pr  446.4s",
            'error: script "check:lane" exited with code 1',
            'error: script "land" exited with code 1',
        ].join("\n");
        expect(classifyLandFailure(log)).toBe("vitest");
    });

    it("charges any other lane failure (tsc, lint, cr:lint) to `static`", () => {
        const log = [
            "lane: ran",
            "  ✗ cr:lint  3.1s",
            "FAIL  3.1s total",
            'error: script "check:lane" exited with code 1',
        ].join("\n");
        expect(classifyLandFailure(log)).toBe("static");
    });

    it("charges a red preflight to the lane too", () => {
        const log =
            "land: preflight is red on the PR's own head (`check:lane --preflight`, exit 1) — …";
        expect(classifyLandFailure(log)).toBe("static");
    });

    it("charges a lane that passed and a merge that did not to `merge`", () => {
        const log = [
            "lane: ran",
            " + 05eec729c...34d8ad7bf fix/issue-4286 -> fix/issue-4286 (forced update)",
            "pr-merge: PR is closed",
            'error: script "land" exited with code 1',
        ].join("\n");
        expect(classifyLandFailure(log)).toBe("merge");
    });

    it("separates a refusal before the queue, colour codes and all", () => {
        const log =
            "\u001b[0m\u001b[31mland: refusing — the health gate is RED and this PR is not a declared repair";
        expect(classifyLandFailure(log)).toBe("refused");
    });

    it("never charges the PR for a saturated machine or a killed run", () => {
        expect(
            classifyLandFailure(
                "land: NOT landed, and NOT failed — the machine stayed saturated"
            )
        ).toBe("infra");
        expect(
            classifyLandFailure(
                'lane: ran\nerror: script "land" was terminated by signal SIGTERM'
            )
        ).toBe("infra");
    });

    it("falls back to `other`", () => {
        expect(
            classifyLandFailure(
                'fatal: not a git repository\nerror: script "land" exited with code 128'
            )
        ).toBe("other");
    });

    it("reads a merge in the log as a landing, marker or not", () => {
        expect(landLogMerged("pr-merge: PR #4881 merged (attempt 1)")).toBe(
            true
        );
        expect(landLogMerged("pr-merge: PR #4881 is merged")).toBe(true);
        expect(landLogMerged("pr-merge: PR is closed")).toBe(false);
    });
});

describe("detach.log lines", () => {
    it("parses durations as health-main prints them", () => {
        expect(parseDuration("45s")).toBe(45);
        expect(parseDuration("6m12s")).toBe(372);
        expect(parseDuration("1h02m")).toBe(3720);
        expect(parseDuration("")).toBeNull();
        expect(parseDuration("soon")).toBeNull();
    });

    it("keeps step durations, fire reasons and verdicts; drops progress", () => {
        expect(
            parseDetachLine("health-main: [5/5] test — exit 0 after 9m41s")
        ).toEqual({ kind: "step", step: "test", exit: "0", secs: 581 });
        expect(
            parseDetachLine(
                "health-cadence: firing on count — 5 landings since the last GREEN (threshold 5); gating aa785cf0"
            )
        ).toEqual({
            kind: "fire",
            trigger: "count",
            reason: "5 landings since the last GREEN (threshold 5); gating aa785cf0",
        });
        expect(
            parseDetachLine("health-main: RED @ 335e4685 (test) — /x.log")
        ).toEqual({ kind: "verdict", verdict: "RED", sha: "335e4685" });
        expect(
            parseDetachLine(
                "health-main: [5/5] test — still running, 2m00s elapsed"
            )
        ).toBeNull();
    });
});
