import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BOT_PINS_TESTS } from "../check-lane";
import {
    BOT_PIN_TESTS,
    REFIT_ARTIFACT_PATHS,
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
        const [, record] = refitPlan([]);
        expect(record.argv.at(-1)).toBe("-u");
        for (const test of BOT_PIN_TESTS) {
            expect(record.argv.indexOf(test)).toBeLessThan(
                record.argv.indexOf("-u")
            );
        }
        expect(record.env.RECORD_BOT_PINS).toBe("1");
        expect(refitPlan([])[0].env.BLADE_FIT_WRITE).toBe("1");
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

/**
 * Issue #7653 — the refit's output is derived state the base writes:
 * `--derive` is the writers' mode, and the paths it writes are its owners'.
 */
describe("bot:refit --derive and the refit artefacts (issue #7653)", () => {
    it("--derive writes the weights then the pins, and asserts nothing", () => {
        const plan = refitPlan(["--derive"]);
        expect(plan.map((s) => s.id)).toEqual(["weights", "pins"]);
        expect(plan[0].env.BLADE_FIT_WRITE).toBe("1");
        expect(plan[1].env.RECORD_BOT_PINS).toBe("1");
    });

    it("--derive with no Verdict Lock reader records the pins only — never a registry-only fit", () => {
        expect(
            refitPlan(["--derive"], { corpusExcluded: true }).map((s) => s.id)
        ).toEqual(["pins"]);
        // The full refit and the check are not the writers': unchanged.
        expect(
            refitPlan([], { corpusExcluded: true }).map((s) => s.id)
        ).toEqual(["weights", "pins", "weights-guard", "pins-guard"]);
    });

    it("--check and --derive together are refused", () => {
        expect(() => refitPlan(["--check", "--derive"])).toThrow(/exclusive/);
    });

    it("the artefacts are the files the fit and the pin tests write", () => {
        // `REFIT_ARTIFACT_PATHS[0]` is the fit's own path: pinned beside
        // `EVAL_WEIGHTS_PATH` in `weightFit.bot.test.ts` (a bot-only module
        // stays out of the app suite, `bot-suite-boundary.test.ts`).
        for (const path of REFIT_ARTIFACT_PATHS)
            expect(() => readFileSync(resolve(ROOT, path))).not.toThrow();
        // Every pin test names exactly one recorded file among them: a
        // fixture it imports, or its vitest snapshot.
        for (const test of BOT_PIN_TESTS) {
            const source = readFileSync(resolve(ROOT, test), "utf8");
            const snapshot = test.replace(/([^/]+)$/, "__snapshots__/$1.snap");
            const owned = REFIT_ARTIFACT_PATHS.filter(
                (p) =>
                    p === snapshot ||
                    source.includes(`./fixtures/${p.split("/").pop()}`)
            );
            expect(owned, test).toHaveLength(1);
        }
        expect(REFIT_ARTIFACT_PATHS).toHaveLength(BOT_PIN_TESTS.length + 1);
    });
});
