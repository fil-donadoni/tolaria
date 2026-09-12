// The activation path is SPLIT, not FORKED (issue #3479).
//
// `convex/gre/activation.ts` holds the pure activation path (CR 602) so the
// browser can replay it: `convex/game.ts` imports `./auth` at its line 4, and
// the client-bundle purity guard (ADR 0074) refuses that import from `src/`,
// which is what kept the blade suite's engine-real `setup` steps — and with
// them 23.0% of the positions a verdict could name — out of the quiz.
//
// The whole safety of that move rests on one claim: `convex/game.ts` RE-EXPORTS
// those names rather than keeping a copy, so the `activateAbility` mutation and
// the browser drive the identical function object. A copy would not fail any
// suite — both halves would keep passing their own tests while drifting a rule
// apart, and the drift would surface as verdicts that silently stop resolving.
// So the pin is object identity, which no amount of divergence can fake.

import { describe, it, expect } from "vitest";
import * as game from "../game";
import * as activation from "../gre/activation";

/** Every name `convex/game.ts` re-exports from the pure module. A new export
 *  added to `gre/activation.ts` and NOT re-exported here is fine; one that is
 *  re-exported as a re-implementation is what this list catches. */
const RE_EXPORTED = [
    "activateAbilityOnState",
    "assertActivationTimingLegal",
    "assertDiscardFilterCostAffordable",
    "assertLoyaltyActivationLegal",
    "assertSacrificeFilterCostAffordable",
    "assertStaticAdditionalCostAffordable",
    "buildPendingActivation",
    "castZoneOwner",
    "findPendingActivationSource",
    "locateCastSource",
    "payCastManaCost",
    "resolveAbilityManaCost",
    "tryAutoCommitPendingActivation",
    "tryAutoCommitPendingCast",
] as const;

describe("convex/game.ts re-exports the pure activation path (issue #3479)", () => {
    for (const name of RE_EXPORTED) {
        it(`\`${name}\` is the SAME function object, not a copy`, () => {
            const fromGame = (game as Record<string, unknown>)[name];
            const fromPure = (activation as Record<string, unknown>)[name];
            expect(typeof fromPure).toBe("function");
            expect(fromGame).toBe(fromPure);
        });
    }

    it("the mutation's entry point is the one the browser can reach", () => {
        // The single load-bearing case, stated on its own so a failure names
        // the thing that breaks: the blade `activate` step and the
        // `activateAbility` mutation must be the same code (CR 602).
        expect(game.activateAbilityOnState).toBe(
            activation.activateAbilityOnState
        );
    });
});
