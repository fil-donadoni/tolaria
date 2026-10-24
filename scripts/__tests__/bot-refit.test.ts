import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BOT_PINS_TESTS } from "../check-lane";
import {
    BOT_PIN_TESTS,
    FIT_WRITE_STEP,
    RECORD_PINS_STEP,
    VERIFY_STEPS,
    refitPlan,
} from "../lib/bot-refit";

const ROOT = resolve(__dirname, "../..");

/**
 * Issue #6690 (ADR 0158 §3) — `bun run bot:refit` regenerates every pin a
 * weight refit moves; `--check` reads the same pins asserting.
 */
describe("bot:refit plan (issue #6690)", () => {
    it("a refit fits and writes the weights BEFORE it records the pins, then verifies both", () => {
        expect(refitPlan([]).map((s) => s.id)).toEqual([
            "weights",
            "pins",
            "weights-guard",
            "pins-guard",
        ]);
    });

    it("--check is the verification alone: nothing it runs records", () => {
        const plan = refitPlan(["--check"]);
        expect(plan).toEqual(VERIFY_STEPS);
        for (const step of plan) {
            expect(step.env.RECORD_BOT_PINS).toBeUndefined();
            expect(step.env.BLADE_FIT_WRITE).toBeUndefined();
            expect(step.argv).not.toContain("-u");
        }
    });

    it("an unknown flag is refused rather than ignored", () => {
        expect(() => refitPlan(["--chek"])).toThrow(/unknown argument/);
    });

    it("-u follows the paths: before them vitest reads the first path as its value", () => {
        const argv = RECORD_PINS_STEP.argv;
        expect(argv.at(-1)).toBe("-u");
        for (const test of BOT_PIN_TESTS) {
            expect(argv.indexOf(test)).toBeLessThan(argv.indexOf("-u"));
        }
        expect(RECORD_PINS_STEP.env.RECORD_BOT_PINS).toBe("1");
        expect(FIT_WRITE_STEP.env.BLADE_FIT_WRITE).toBe("1");
    });

    it("every pin test exists and the lane's cheap guards cover the pins the search-cost and weight guards do not", () => {
        for (const test of BOT_PIN_TESTS) {
            expect(() =>
                readFileSync(resolve(ROOT, test), "utf8")
            ).not.toThrow();
        }
        const covered = new Set([
            "convex/gre/__tests__/searchCost.bot.test.ts",
            ...BOT_PINS_TESTS,
        ]);
        expect([...covered].sort()).toEqual([...BOT_PIN_TESTS].sort());
    });
});
