// Every blade setup step replays from the BROWSER-REACHABLE builder
// (issue #3479, PRD #3397).
//
// The verdict quiz rebuilds the judged position in the browser, because the
// candidate keys it submits must be allocated by the same build the fit will
// redo months later (`verdicts/lowering.ts`). Until this issue it could only
// rebuild a position with NO setup steps: `blade/setup.ts` imported
// `convex/game.ts`, whose line-4 `./auth` import the client-bundle purity guard
// (ADR 0074) refuses from `src/`. Measured over five matchups (PR #3474), 23.0%
// of the 1300 decisions with a non-empty stack hold an activated ability —
// the share the `activate` step alone gated.
//
// `buildVerdictPosition` is the pure entry point the browser reaches (the chain
// `src/lib/ai/verdict-quiz.ts` → `verdicts/lowering` → `verdicts/candidates` →
// `blade/build` → `blade/setup` → `gre/activation` is what the purity guard now
// walks). These cases assert the steps DO something through it — a cost really
// paid, a spell really on the stack — rather than that a builder returned a
// state: an extraction that quietly lost the cost-payment machinery would
// otherwise pass a shape check.

import { describe, it, expect } from "vitest";
import { buildVerdictPosition } from "../verdicts/candidates";
import { buildBladeState } from "../blade/runner";
import type { BladeSetupStep } from "../blade/types";
import type { GameState } from "../../state";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

/** The charter fetchland board (`blade/registry.ts`), trimmed to what these
 *  cases read. No `libraryCount`: it would flood the fetch pool with basics. */
const FETCH_SPEC: ScenarioSpec = {
    cards: [
        { name: "Polluted Delta", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Terror", owner: "me", zone: "hand" },
        { name: "Island", owner: "me", zone: "library" },
        { name: "Swamp", owner: "me", zone: "library" },
        {
            name: "Hill Giant",
            owner: "opp",
            zone: "battlefield",
            summoningSick: false,
        },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
};

const BOLT_SPEC: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Lightning Bolt", owner: "me", zone: "hand" },
        {
            name: "Hill Giant",
            owner: "opp",
            zone: "battlefield",
            summoningSick: false,
        },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    libraryCount: 20,
};

const DREADNOUGHT_SPEC: ScenarioSpec = {
    cards: [
        {
            name: "Phyrexian Dreadnought",
            owner: "me",
            zone: "battlefield",
            summoningSick: true,
        },
        { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    libraryCount: 20,
};

function me(state: GameState) {
    return state.players[0];
}

describe("blade setup steps replay from the pure builder (issue #3479)", () => {
    it("`activate` runs the REAL CR 602 path — costs and all", () => {
        const state = buildVerdictPosition(FETCH_SPEC, [
            { kind: "activate", card: "Polluted Delta" },
        ]);

        // The ability is on the stack, unresolved (CR 602.2a).
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe("polluted-delta-fetch");

        // And its costs were PAID by the extracted machinery, not skipped:
        // Polluted Delta is "{T}, Pay 1 life, Sacrifice this land" (CR 119.4
        // life payment, CR 118.5 sacrifice), so the seat is down a life and
        // the land has left the
        // battlefield. This is the assertion that fails if the extraction
        // loses a cost leg.
        expect(me(state).life).toBe(19);
        expect(me(state).battlefield).toHaveLength(1);
    });

    it("`activate` + `resolve-top` reaches the live search-library choice", () => {
        const state = buildVerdictPosition(FETCH_SPEC, [
            { kind: "activate", card: "Polluted Delta" },
            { kind: "resolve-top" },
        ]);

        // CR 701.23 — the fetch's search is a real owed choice, over exactly
        // the two cards the library can supply.
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("search-library");
        expect(state.pendingChoices![0].candidateIds).toHaveLength(2);
    });

    it("`cast` puts a real spell on the stack", () => {
        const state = buildVerdictPosition(BOLT_SPEC, [
            {
                kind: "cast",
                card: "Lightning Bolt",
                by: "me",
                target: "Hill Giant",
            },
        ]);

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBeUndefined();
        expect(me(state).hand).toHaveLength(0);
    });

    it("`etb-trigger` puts a real trigger on the stack", () => {
        const state = buildVerdictPosition(DREADNOUGHT_SPEC, [
            { kind: "etb-trigger", card: "Phyrexian Dreadnought" },
        ]);

        expect(state.stack).toHaveLength(1);
    });

    it("`discard` moves the card through the real chokepoint", () => {
        const state = buildVerdictPosition(FETCH_SPEC, [
            { kind: "discard", card: "Terror" },
        ]);

        expect(me(state).hand).toHaveLength(0);
        expect(me(state).graveyard).toHaveLength(1);
    });

    it("builds the position the blade HARNESS builds, down to the instance ids", () => {
        // The pin (issue #3479, the shape `verdictStatesAgree` uses): the
        // browser's builder and the harness's are the same function, so a
        // future re-fork — a normalisation added to one, an extra untap — reds
        // here rather than silently keying verdicts off ids the fit's own
        // rebuild never allocates.
        const setup: BladeSetupStep[] = [
            { kind: "activate", card: "Polluted Delta" },
            { kind: "resolve-top" },
        ];
        const viaHarness = buildBladeState({
            label: "verdict",
            spec: FETCH_SPEC,
            setup,
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });

        expect(buildVerdictPosition(FETCH_SPEC, setup)).toEqual(viaHarness);
    });
});
