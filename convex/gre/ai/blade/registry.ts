/**
 * Blade-scenario suite — the registry (issue #1427, PRD #1423).
 *
 * A flat, code-side list of positions where the right play is not a matter of
 * opinion. The entries live in `scenarios.ts`; add one by COPYING one there:
 * label, `spec` (the same `ScenarioSpec` vocabulary the Debug panel speaks),
 * the seat the bot plays, an ITERATIONS budget, a tier, and an expectation.
 *
 * Tier discipline:
 *   - `must`    — the bot is expected to get this right TODAY. Blocking CI
 *                 (`bun run test:blade`). Never land an entry here red.
 *   - `stretch` — a position the bot is not expected to solve yet. Report-only
 *                 (`bun run test:blade:stretch`); it prints its verdict and
 *                 never fails the build. Promote it to `must` in the PR that
 *                 makes it pass.
 */

import type { BladeScenario } from "./types";
import { BLADE_SCENARIOS } from "./scenarios";

export { BLADE_SCENARIOS };

/** Entries of one tier, in registry order. */
export function bladeScenariosForTier(
    tier: BladeScenario["tier"]
): BladeScenario[] {
    return BLADE_SCENARIOS.filter((s) => s.tier === tier);
}

/**
 * Look up one entry by its exact `label` (issue #1432 — the Debug panel's
 * read-only blade loader resolves the entry server-side from a client-
 * supplied label, so the registry — not the client — is the sole source of
 * the `spec` that gets applied to a board).
 */
export function findBladeScenario(label: string): BladeScenario | undefined {
    return BLADE_SCENARIOS.find((s) => s.label === label);
}
