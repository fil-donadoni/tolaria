// The search never writes into the state it was handed (ADR 0000 §4, issue
// #10026).
//
// `cloneGameState` shares every value under `SHARED_KEYS` by reference: the
// card ref and an object's characteristic lists (`types`, `subtypes`,
// `staticAbilities` and their `base*` layer bases). Those values are the
// ORIGINAL's own arrays, reached from every world the search derives from it,
// so one in-place write into them — a `push` in some resolution path instead
// of a reassignment — changes the position the caller still holds, and every
// sibling world with it. A bug of that shape reds nothing else: the search
// swallows engine throws (`catch {}` around its probes) and a corrupted world
// reads as ordinary weak play.
//
// This is the DYNAMIC half: every blade `must` position is searched, and the
// position handed in must come back deep-equal to a snapshot taken before.
// It catches every write the search actually reaches. The STATIC half — no
// engine source mutates a shared list in place, on a path no position reaches
// yet — is in `clone.test.ts`, an application test cheap enough for every
// lane.
//
// Lives in a `*.bot.test.ts` file because `convex/gre/search.ts` is a declared
// bot module (`bot-suite-boundary.test.ts` / `BOT_MODULE_EXACT`).
import { describe, expect, it } from "vitest";
import { searchWithTrace } from "../search";
import { bladeScenariosForTier } from "../ai/blade/registry";
import {
    bladeDeckKnowledge,
    buildBladeState,
    DEFAULT_BLADE_SEED,
} from "../ai/blade/runner";
import { seatPlayerId } from "../ai/blade/matcher";

/** Enough iterations to expand every root candidate and play out below it;
 *  the guard is about which code paths run, not how well the search plays. */
const ITERATIONS = 10;

describe("search aliasing: the handed state is never written (issue #10026)", () => {
    const scenarios = bladeScenariosForTier("must");

    it("covers the blade must corpus", () => {
        expect(scenarios.length).toBeGreaterThan(0);
    });

    it.each(scenarios.map((s) => [s.label, s] as const))(
        "%s",
        (_label, scenario) => {
            const state = buildBladeState(scenario);
            const before = structuredClone(state);
            const botId = seatPlayerId(state, scenario.bot);
            searchWithTrace(
                state,
                botId,
                { iterations: ITERATIONS },
                DEFAULT_BLADE_SEED,
                bladeDeckKnowledge(state, scenario)
            );
            expect(state).toEqual(before);
        }
    );
});
