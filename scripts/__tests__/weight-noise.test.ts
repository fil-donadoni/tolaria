import { describe, it, expect } from "vitest";
import { BOT_PIN_TESTS, WEIGHT_FIT_TEST } from "../lib/bot-refit";
import {
    FITTED_WEIGHTS_MODULE,
    nudgeWeightsSource,
    noiseCheckedFiles,
    weightNoiseVitestArgs,
} from "../lib/weight-noise";

const SOURCE = "a: 8,\nb: 1.500000,\nc: 155.155678,\nd: -2.000001,\n";

describe("the weights nudge", () => {
    it("moves every fitted literal by its last digit and no other number", () => {
        expect(nudgeWeightsSource(SOURCE)).toBe(
            "a: 8,\nb: 1.499999,\nc: 155.155679,\nd: -2.000002,\n"
        );
    });

    it("refuses a module it cannot move, rather than proving nothing", () => {
        expect(() => nudgeWeightsSource("a: 8,\n")).toThrow(/no fitted/);
    });

    it("reads the module the fit writes", () => {
        expect(
            FITTED_WEIGHTS_MODULE.test(
                "/repo/convex/gre/ai/fittedEvalWeights.ts"
            )
        ).toBe(true);
    });
});

describe("the files the guard runs", () => {
    it("are the diff's bot-node tests, not the pins a refit re-records", () => {
        const other = "convex/gre/ai/__tests__/x.bot.test.ts";
        expect(
            noiseCheckedFiles([
                other,
                "convex/gre/ai/opValuers.ts",
                "convex/gre/__tests__/y.test.ts",
                "src/components/__tests__/z.bot.test.tsx",
                ...BOT_PIN_TESTS,
                WEIGHT_FIT_TEST,
                "scripts/__tests__/ladder-worker-boundary.bot.test.ts",
            ])
        ).toEqual([other]);
    });
});

describe("the run under the nudge", () => {
    it("reads a file of another project as nothing to check, not a red", () => {
        expect(weightNoiseVitestArgs(["a.bot.test.ts"])).toContain(
            "--passWithNoTests"
        );
    });
});
