/**
 * Blade-scenario registry lookup (issue #1432, PRD #1423).
 *
 * `findBladeScenario` is the pure lookup the read-only browser loader's
 * `debugLoadBladeScenario` mutation (`convex/game.ts`) uses to resolve a
 * client-supplied `label` against the code-side registry SERVER-SIDE — the
 * client never supplies a `spec` directly, only picks a label.
 */

import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS, findBladeScenario } from "../registry";

describe("findBladeScenario (issue #1432)", () => {
    it("resolves every registered label to its own entry", () => {
        for (const scenario of BLADE_SCENARIOS) {
            expect(findBladeScenario(scenario.label)).toBe(scenario);
        }
    });

    it("returns undefined for an unknown label", () => {
        expect(findBladeScenario("no such scenario")).toBeUndefined();
    });

    it("returns undefined for an empty label", () => {
        expect(findBladeScenario("")).toBeUndefined();
    });
});
