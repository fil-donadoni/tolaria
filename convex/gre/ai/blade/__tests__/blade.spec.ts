/**
 * Blade-scenario suite — the runnable suite (issue #1427, PRD #1423).
 *
 * NOT part of `bun run test`. Run it with:
 *   bun run test:blade           → `must` tier, real assertions, BLOCKING
 *   bun run test:blade:stretch   → `stretch` tier, REPORT-ONLY (never fails)
 *
 * The tier is selected by the `BLADE_TIER` env var (default `must`) so both
 * modes share one spec file and one config — see `vitest.blade.config.ts`.
 */

import { describe, expect, it } from "vitest";
import {
    BLADE_SCENARIOS,
    bladeScenariosForTier,
    runBladeScenario,
    type BladeScenario,
    type BladeTier,
} from "..";

const TIER = (process.env.BLADE_TIER ?? "must") as BladeTier;

if (TIER !== "must" && TIER !== "stretch") {
    throw new Error(
        `BLADE_TIER must be "must" or "stretch" (got "${process.env.BLADE_TIER}").`
    );
}

const scenarios = bladeScenariosForTier(TIER);

describe(`blade suite — registry integrity`, () => {
    it("every entry has a unique label", () => {
        const labels = BLADE_SCENARIOS.map((s) => s.label);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it("every entry uses an iterations budget, never wall-clock", () => {
        for (const s of BLADE_SCENARIOS) {
            expect(
                s.budget.iterations,
                `${s.label}: iterations must be positive`
            ).toBeGreaterThan(0);
            // A `timeMs` budget would make the chosen move machine-dependent.
            expect(
                Object.keys(s.budget),
                `${s.label}: budget must declare iterations only`
            ).toEqual(["iterations"]);
        }
    });
});

describe(`blade suite — ${TIER} tier`, () => {
    if (scenarios.length === 0) {
        it(`has no ${TIER} scenarios registered`, () => {
            expect(scenarios).toHaveLength(0);
        });
    }

    for (const scenario of scenarios) {
        it(scenario.label, () => {
            const result = runBladeScenario(scenario);
            if (TIER === "stretch") {
                // Report-only: a stretch entry documents a position the bot is
                // not expected to solve yet. Print the verdict, never fail.
                const verdict = result.ok ? "PASS" : "FAIL";
                const detail = result.ok
                    ? result.seeds
                          .map((s) => `seed ${s.seed}: ${s.moveDescription}`)
                          .join("; ")
                    : result.failureMessage;
                console.log(
                    `[blade:stretch] ${verdict} ${scenario.label} — ${detail}`
                );
                return;
            }
            expect(result.ok, result.failureMessage).toBe(true);
        });
    }
});

describe("blade suite — determinism (acceptance criterion, #1427)", () => {
    // The suite is only a metric if it is reproducible. Re-running an entry
    // with the same registry and the same seeds must produce the identical
    // chosen move — same machine, same run, and (because the base state, the
    // shuffle seed and the iteration budget are all fixed constants) any other
    // machine too.
    const probe: BladeScenario | undefined = scenarios[0] ?? BLADE_SCENARIOS[0];

    it("re-running a scenario yields the identical chosen move", () => {
        if (!probe) return;
        const first = runBladeScenario(probe);
        const second = runBladeScenario(probe);
        expect(second.seeds.map((s) => s.move)).toEqual(
            first.seeds.map((s) => s.move)
        );
        expect(second.ok).toBe(first.ok);
    });
});
