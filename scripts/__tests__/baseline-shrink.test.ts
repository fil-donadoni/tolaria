import { describe, it, expect } from "vitest";
import {
    baselineAdditions,
    baselineNames,
    ROUND_TRIP_BASELINE_PATH,
} from "../lib/baseline-shrink";
import { classifyLane } from "../check-lane";

/** Guard C's baseline only shrinks — the diff half (issue #5942). */

const file = (gap: string[], undetermined: string[] = []) =>
    [
        "export const COMPILER_GAP_ROWS: readonly string[] = [",
        ...gap.map((n) => `    ${JSON.stringify(n)},`),
        "];",
        "export const UNDETERMINED_ROWS: readonly string[] = [",
        ...undetermined.map((n) => `    ${JSON.stringify(n)},`),
        "];",
    ].join("\n");

describe("baselineAdditions", () => {
    it("reads every row, escaped quotes and accents included", () => {
        expect([...baselineNames(file(['Say "Hi"', "Æther Storm"]))]).toEqual([
            'Say "Hi"',
            "Æther Storm",
        ]);
    });

    it("a pure deletion adds nothing", () => {
        expect(baselineAdditions(file(["A", "B"]), file(["A"]))).toEqual([]);
    });

    it("a row added back — a graduated card returning — is named", () => {
        expect(
            baselineAdditions(file(["A"]), file(["A", "Regressed"]))
        ).toEqual(["Regressed"]);
    });

    it("a swap (a graduate out, a new card in) still names the new card", () => {
        expect(baselineAdditions(file(["A", "B"]), file(["A", "C"]))).toEqual([
            "C",
        ]);
    });

    it("moving a row between direction arrays is free", () => {
        expect(baselineAdditions(file(["A", "B"]), file(["A"], ["B"]))).toEqual(
            []
        );
    });
});

describe("check-lane admits check:baseline-shrink on the baseline alone", () => {
    const planned = (files: string[]) =>
        classifyLane(files).run.some((c) => c.id === "check:baseline-shrink");

    it("runs when the baseline changes, not otherwise", () => {
        expect(planned([ROUND_TRIP_BASELINE_PATH])).toBe(true);
        expect(
            planned(["convex/cards/__tests__/compilerRoundTrip.test.ts"])
        ).toBe(false);
    });
});
