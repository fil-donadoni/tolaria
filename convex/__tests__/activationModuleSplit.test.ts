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

/** Every name `convex/game.ts` re-exports from the pure module, DERIVED rather
 *  than listed: a name that appears in both namespaces is either the re-export
 *  or the re-implementation that replaced it, which is exactly the pair this
 *  file is here to tell apart. A list would have to be remembered; this cannot
 *  fall behind a re-export added later. */
const RE_EXPORTED = Object.keys(activation).filter((name) => name in game);

describe("convex/game.ts re-exports the pure activation path (issue #3479)", () => {
    it("covers the names the two modules actually share", () => {
        // The floor, so the derived set can never go vacuously empty — a
        // `game.ts` that re-exported nothing would otherwise make every
        // assertion below disappear rather than fail.
        expect(RE_EXPORTED.length).toBeGreaterThanOrEqual(14);
        expect(RE_EXPORTED).toContain("activateAbilityOnState");
    });

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
