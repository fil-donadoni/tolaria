/**
 * A planeswalker's removal ability picks the permanent whose removal swings
 * the position most (issue #9974, CR 606.3).
 *
 * Each legal target of Teferi's −3 is its own root Move, so the leaf
 * `evaluate` decides between them. It once priced Chandra, Torch of Defiance
 * at 5 loyalty below a 1/1 token, because a walker's worth read no loyalty
 * ability (issue #9973's loyalty arm fixed it). This test runs the two blade
 * `must` entries on two seeds, so the guard is visible without the blade
 * suite.
 */

import { describe, expect, it } from "vitest";
import { runBladeScenario } from "../ai/blade/runner";
import { BLADE_SCENARIOS } from "../ai/blade/scenarios";
import type { BladeScenario } from "../ai/blade/types";

const LOADED_WALKER =
    "walker removal: tucks the loaded planeswalker, not the 1/1 token";
const THREATENING_TOKEN =
    "walker removal: tucks the threatening token over an idle permanent";

function entry(label: string): BladeScenario {
    const found = BLADE_SCENARIOS.find((s) => s.label === label);
    if (!found) throw new Error(`no blade entry "${label}"`);
    return found;
}

describe("walker removal target (issue #9974, CR 606.3)", () => {
    // A 400-iteration search per seed; the budget is explicit (fixed
    // iterations, never time).
    it("Teferi's −3 tucks Chandra at 5 loyalty, not the 1/1 token", () => {
        const result = runBladeScenario({
            ...entry(LOADED_WALKER),
            seeds: [0xb1ade, 1],
        });
        expect(result.ok, result.failureMessage).toBe(true);
    }, 480_000);

    it("Teferi's −3 tucks the 5/3 token over an idle Exploration", () => {
        const result = runBladeScenario({
            ...entry(THREATENING_TOKEN),
            seeds: [0xb1ade, 1],
        });
        expect(result.ok, result.failureMessage).toBe(true);
    }, 480_000);
});
