/**
 * Blade-scenario suite — the registry (issue #1427, PRD #1423).
 *
 * A flat, code-side list of positions where the right play is not a matter of
 * opinion. Add an entry by COPYING one below: label, `spec` (the same
 * `ScenarioSpec` vocabulary the Debug panel speaks), the seat the bot plays,
 * an ITERATIONS budget, a tier, and an expectation.
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

export const BLADE_SCENARIOS: BladeScenario[] = [
    {
        // POSITIVE CONTROL (#1427). Deliberately the least ambiguous decision
        // in Magic: it is the bot's main phase, it has one land in hand, an
        // empty board, and nothing else it can do. Playing the land is
        // strictly non-negative (CR 305.2 — a land drop can never cost you
        // anything) and the engine guarantees it: `selectRootMove`'s
        // develop tie-break (search.ts, issue #149) takes an outcome-equal
        // `play-land` over `pass`.
        //
        // Its job is to validate the HARNESS end to end — spec → base state →
        // buildStateFromScenario → searchWithTrace → name-resolved matcher —
        // not to stress the bot. If this entry ever goes red, suspect the
        // harness (or a genuine land-drop regression) before the position.
        label: "positive-control: plays its only land on an empty board",
        spec: {
            cards: [{ name: "Forest", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 200 },
        tier: "must",
        expect: { moves: [{ kind: "play-land", card: "Forest" }] },
        note: "Harness end-to-end control. Guards the issue-#149 land-drop invariant.",
    },
    {
        // STRETCH. A lone 3/3 facing an empty board: attacking is free damage
        // (no blockers, no crackback the position can produce) and passing the
        // combat step throws a turn away. It PASSES today; it is kept in the
        // stretch tier on purpose — it keeps the report-only path exercised,
        // and attacker-subset enumeration plus rollout noise make it the kind
        // of entry that can go seed-sensitive, which is exactly what this tier
        // is for. Promote it to `must` once it is proven stable across seeds.
        label: "stretch: attacks with a lone 3/3 into an empty board",
        spec: {
            cards: [
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 400 },
        tier: "stretch",
        expect: {
            moves: [{ kind: "declare-attackers", card: "Hill Giant" }],
        },
        note: "Free damage: no possible blocker, no crackback in the position.",
    },
];

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
