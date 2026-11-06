// A test that subtracts two valuations asserts through the rounding rule, or the
// next refit reds it with noise (`pointsGrid.helper.ts` states the rule).

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
    findUnroundedPointsSubtractions,
    roundToPointsGrid,
} from "./pointsGrid.helper";

const ROOT = resolve(__dirname, "../../../..");
const SWEPT_DIRS = ["convex", "src"];
const THIS_FILE = "pointsSubtractionRounded.bot.test.ts";

function testFiles(): string[] {
    return SWEPT_DIRS.flatMap((dir) =>
        readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
            .filter((p) => p.endsWith(".test.ts") && !p.endsWith(THIS_FILE))
            .map((p) => join(ROOT, dir, p))
    );
}

describe("a points difference asserted in a test", () => {
    it("goes through the rounding rule, in every test file", () => {
        const offenders = testFiles().flatMap((file) =>
            findUnroundedPointsSubtractions(readFileSync(file, "utf8")).map(
                (line) => `${file}:${line}`
            )
        );
        expect(offenders).toEqual([]);
    });

    it("the scanner reads the bare, the rounded and the wrapped shape", () => {
        expect(
            findUnroundedPointsSubtractions("x = all.points - head.points;")
        ).toEqual([1]);
        expect(
            findUnroundedPointsSubtractions(
                "x = roundToPointsGrid(all.points - head.points);"
            )
        ).toEqual([]);
        expect(
            findUnroundedPointsSubtractions(
                "x = roundToPointsGrid(\n    all.points - head.points\n);"
            )
        ).toEqual([]);
    });

    it("the rule absorbs the noise the refit produced and keeps a real gap", () => {
        expect(roundToPointsGrid(155.15567799999997)).toBe(
            roundToPointsGrid(155.155678)
        );
        expect(roundToPointsGrid(155.15567800000002)).toBe(
            roundToPointsGrid(155.155678)
        );
        expect(roundToPointsGrid(155.155679)).not.toBe(
            roundToPointsGrid(155.155678)
        );
    });
});
