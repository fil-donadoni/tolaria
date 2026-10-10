import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    describeWalkPlan,
    FULL_WALK_ENTRY,
    planHealthWalk,
    SKIPPED_REASON,
    walkWasFull,
} from "../lib/health-walk-plan";
import { HEALTH_SCRIPTS, splitHealthGates } from "../lib/health-step";

/**
 * Batch health owes no browser walk; only `release` (`--ui-all`) walks, in
 * full (ADR 0131 amendment, issue #5378).
 */
describe("planHealthWalk", () => {
    it("a batch run owes no walk, and the reason names the decision", () => {
        const plan = planHealthWalk({ forceAll: false });
        expect(plan).toEqual({ kind: "skipped", reason: SKIPPED_REASON });
        expect(describeWalkPlan(plan)).toMatch(
            /^skipped — .*release step.*#5378/
        );
    });

    it("--ui-all / release walks FULL: the HEALTH_SCRIPTS walk entry", () => {
        const plan = planHealthWalk({ forceAll: true });
        expect(plan.kind).toBe("full");
        expect(describeWalkPlan(plan)).toMatch(/^full — /);
        expect(splitHealthGates(HEALTH_SCRIPTS).walk).toEqual([
            FULL_WALK_ENTRY,
        ]);
    });
});

describe("walkWasFull — what release trusts", () => {
    it("only a green full walk, or a record from before any batch rule", () => {
        const skipped = describeWalkPlan(planHealthWalk({ forceAll: false }));
        const full = describeWalkPlan(planHealthWalk({ forceAll: true }));
        expect(walkWasFull({ ui: "skipped", walk: skipped })).toBe(false);
        expect(
            walkWasFull({ ui: "green", walk: "scoped — 1 surface(s): a" })
        ).toBe(false);
        expect(walkWasFull({ ui: "green", walk: full })).toBe(true);
        expect(walkWasFull({ ui: "green" })).toBe(true);
        expect(walkWasFull({ ui: "red", walk: full })).toBe(false);
    });
});

describe("release", () => {
    it("keeps the full walk: health-main is spawned with --ui-all", () => {
        const src = readFileSync(join(__dirname, "..", "release.ts"), "utf8");
        expect(src).toMatch(
            /\[HEALTH_MAIN, `--branch=\$\{BASE_BRANCH\}`, "--ui-all"\]/
        );
    });
});
