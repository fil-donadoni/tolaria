// A test file that subtracts two valuations asserts through the rounding rule, or
// the next refit reds it with noise (`pointsGrid.helper.ts` states the rule).

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { findExactPointsAssertions, roundPoints } from "./pointsGrid.helper";

const ROOT = resolve(__dirname, "../../../..");
const SWEPT_DIRS = ["convex", "src"];
const TEST_SOURCE = /\.(test|helper)\.tsx?$/;
const THIS_FILE = "pointsSubtractionRounded.bot.test.ts";

function testFiles(): string[] {
    return SWEPT_DIRS.flatMap((dir) =>
        readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
            .filter((p) => TEST_SOURCE.test(p) && !p.endsWith(THIS_FILE))
            .map((p) => join(ROOT, dir, p))
    );
}

const noisy = (source: string) => findExactPointsAssertions("t.ts", source);

describe("an exact assertion on points in a file that subtracts them", () => {
    it("goes through the rounding rule, in every test file", () => {
        const offenders = testFiles().flatMap((file) =>
            findExactPointsAssertions(file, readFileSync(file, "utf8")).map(
                (line) => `${file}:${line}`
            )
        );
        expect(offenders).toEqual([]);
    });

    it("the scanner reads every shape of the subtraction", () => {
        const assertion = "\nexpect(v.points).toBe(1);";
        for (const subtraction of [
            "x = all.points - head.points;",
            "x = all.points -\n    head.points;",
            "x = (a?.points ?? 0) - (b?.points ?? 0);",
            "x = f(a).points - f(b).points;",
        ])
            expect(noisy(subtraction + assertion)).not.toEqual([]);
    });

    it("the scanner leaves alone what carries no noise", () => {
        expect(noisy("expect(v.points).toBe(1);")).toEqual([]);
        expect(
            noisy("x = a.points - b.points;\nexpect(x.points).toBeCloseTo(1);")
        ).toEqual([]);
    });
});

describe("the rounding rule", () => {
    it("reads the noise the refit produced as no difference, either sign", () => {
        expect(roundPoints(155.15567799999997 - 155.155678)).toBe(0);
        expect(roundPoints(155.15567800000002 - 155.155678)).toBe(0);
    });

    it("keeps a fitted weight's last digit as a difference", () => {
        expect(roundPoints(155.155679 - 155.155678)).not.toBe(0);
    });
});
