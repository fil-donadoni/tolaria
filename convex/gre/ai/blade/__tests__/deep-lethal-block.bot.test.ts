/**
 * Deep lethal-block — live regression guard for the LEAF `lethalUnblockedDelta`
 * seam (issue #1505).
 *
 * The blade registry entry "deep lethal block: does NOT greedily swing its only
 * blocker" is a `stretch` entry: at the production 400-iteration budget the
 * crackback that punishes the greedy swing is beyond the rollout horizon, so
 * the registry harness only asserts that the bot FAILS at 400 (the
 * `beyondBudget` claim). That harness therefore does NOT redden if the leaf
 * term is removed — removing it keeps the bot failing at 400.
 *
 * This file supplies the teeth the stretch tier cannot: at 900 iterations — the
 * window where the rollout reliably reaches the crackback but the search tree
 * has not yet expanded it to the real damage step (which would read the death
 * off the life total directly, leaf-independently) — the leaf term IS decisive.
 * WITH it the bot holds its only blocker back and survives; WITHOUT it
 * (`0 * lethalUnblockedDelta(...)` in `evaluate.ts`, `blockDeltaOf` untouched)
 * the bot swings the flyer for a free 3 and dies to the crackback. The five
 * seeds below were measured to flip cleanly on that mutation, so this test goes
 * red exactly when the leaf seam is removed.
 *
 * The root move is a `declare-attackers`, so the root `blockDeltaOf` block-
 * quality tie-break (gated on `declare-blockers`) is structurally inert — this
 * bites the leaf `evaluate` seam and nothing else.
 *
 * CR references: 508.1 (attack declaration), 508.1f (attacking taps), 509.1
 * (block declaration), 510.1c (combat damage to the defending player), 704.5a
 * (a player at 0 or less life loses).
 */

import { describe, it, expect } from "vitest";
import { findBladeScenario, runBladeScenario } from "..";

const LABEL = "deep lethal block: does NOT greedily swing its only blocker";

/** The window where the leaf term is decisive (see file header): high enough
 *  that the rollout reaches the crackback, low enough that the tree has not
 *  subsumed it via the terminal life check. */
const DECISIVE_ITERATIONS = 900;

describe("deep lethal block — leaf lethalUnblockedDelta guard (issue #1505)", () => {
    it("holds its only blocker back instead of swinging into a fatal crackback", () => {
        const entry = findBladeScenario(LABEL);
        expect(entry, `blade entry "${LABEL}" must exist`).toBeDefined();

        // Re-run the registry position at the leaf term's decisive budget. The
        // entry's own `forbidden` expectation (swing the Phantom Monster) is the
        // blunder; every declared seed must reject it here.
        const result = runBladeScenario({
            ...entry!,
            budget: { iterations: DECISIVE_ITERATIONS },
        });

        expect(result.ok, result.failureMessage).toBe(true);
    });
});
