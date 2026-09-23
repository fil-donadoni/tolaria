// The `coinFlipSeries` Op's permanent test (CR 705, issue #3813, ADR 0144).
//
//   705.2  … the player that flips the coin calls "heads" or "tails." If the
//          call matches the result, the player wins the flip. Otherwise, the
//          player loses the flip.
//
// The series draws each bit from the seeded `SpellContext.flipCoin`, so a seed
// fixes the sequence. Sequences used below (W = the flipper wins):
//   seed 31 → W W W L …     seed 25 → W W W W L …     seed 2 → W L L W W W
//   seed 7  → L L W …

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import { grizzlyBears } from "../../../cards/sets/lea/green";
import { squeesRevenge } from "../../../cards/sets/apc/multicolor";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";
import { resolveTopOfStack } from "../../state";
import type { GameState } from "../../state";
import { applyNumberChoiceSubmit } from "../../pendingChoiceSubmit";
import { compactState, expandState } from "../../serialize";
import { projectPublicState } from "../../../gameProjections";
import { validateEffectScript } from "../validate";

function registerScript(id: string, effects: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    });
    return id;
}

function library(owner: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `${owner}-lib-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );
}

function stateWithSeed(rngSeed: number): GameState {
    return makeState({
        rngSeed,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { library: library("p1", 20) }),
            makePlayer("p2", { library: library("p2", 20) }),
        ],
    });
}

/** Each count lands in a life total, so a binding the reader never saw fails
 *  the assertion instead of reading 0. */
function readBack(series: Extract<EffectOp, { op: "coinFlipSeries" }>) {
    return [
        { ...series, bindFlips: "$f", bindWins: "$w", bindLosses: "$l" },
        { op: "gainLife", player: "controller", amount: { ref: "$f" } },
        { op: "loseLife", player: "opponent", amount: { ref: "$w" } },
        {
            op: "gainLife",
            player: "opponent",
            amount: { scaled: { value: { ref: "$l" }, times: 10 } },
        },
    ] as EffectOp[];
}

describe("Effect Script Op: coinFlipSeries (CR 705, issue #3813)", () => {
    it("stops at the FIRST lost flip with untilLoss and no count (CR 705.2)", () => {
        const id = registerScript(
            "test-op-flipseries-until-loss",
            readBack({ op: "coinFlipSeries", untilLoss: true })
        );
        const state = stateWithSeed(25); // W W W W L
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].life).toBe(25); // 5 flips
        // 4 wins lost by p2, 1 loss gained back ×10.
        expect(state.players[1].life).toBe(20 - 4 + 10);
    });

    it("keeps flipping through losses when only a count bounds it", () => {
        const id = registerScript(
            "test-op-flipseries-count-only",
            readBack({ op: "coinFlipSeries", count: 5 })
        );
        const state = stateWithSeed(2); // W L L W W
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(25); // exactly 5 flips
        expect(state.players[1].life).toBe(20 - 3 + 20); // 3 won, 2 lost
    });

    it("ends at the count when it comes before the first loss", () => {
        const id = registerScript(
            "test-op-flipseries-count-first",
            readBack({ op: "coinFlipSeries", count: 2, untilLoss: true })
        );
        const state = stateWithSeed(31); // W W | W L
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(22);
        expect(state.players[1].life).toBe(18); // 2 won, 0 lost
    });

    it("a count of 0 flips nothing and binds zeros (CR 107.1c)", () => {
        const id = registerScript(
            "test-op-flipseries-zero",
            readBack({ op: "coinFlipSeries", count: 0, untilLoss: true })
        );
        const state = stateWithSeed(31);
        const counter = state.rngCounter;
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.rngCounter).toBe(counter); // no bit drawn
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
    });

    it("a re-walk after a later suspension never flips again (engine invariant), across a serialize round-trip", () => {
        const id = registerScript("test-op-flipseries-rewalk", [
            {
                op: "coinFlipSeries",
                untilLoss: true,
                bindWins: "$w",
            },
            {
                op: "chooseNumber",
                player: "controller",
                prompt: "Choose a number",
                bind: "$n",
            },
            { op: "gainLife", player: "controller", amount: { ref: "$w" } },
            { op: "loseLife", player: "opponent", amount: { ref: "$n" } },
        ]);
        const state = stateWithSeed(25); // W W W W L
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the pick
        const counterAtSuspend = state.rngCounter;

        // The persisted state is what the next mutation loads.
        const reloaded = expandState(compactState(state));
        applyNumberChoiceSubmit(reloaded, { playerId: "p1", amount: 3 });

        // The resumed walk re-reached the series and read it back: no bit
        // drawn, and the wins are the ones realised before the suspension.
        expect(reloaded.rngCounter).toBe(counterAtSuspend);
        expect(reloaded.players[0].life).toBe(24);
        expect(reloaded.players[1].life).toBe(17);
        expect(reloaded.stack).toHaveLength(0);
    });

    it("the flipper can be another player (CR 705.2 — only the flipper wins or loses)", () => {
        const id = registerScript(
            "test-op-flipseries-opponent",
            readBack({
                op: "coinFlipSeries",
                player: "opponent",
                count: 3,
            })
        );
        const state = stateWithSeed(31); // W W W
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23);
        expect(state.players[1].life).toBe(17);
    });
});

describe("Squee's Revenge — the series payoff (CR 705.2, issue #3813)", () => {
    function castAndChoose(seed: number, amount: number): GameState {
        const state = stateWithSeed(seed);
        pushSpell(state, squeesRevenge.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].kind).toBe("number-pick");
        applyNumberChoiceSubmit(state, { playerId: "p1", amount });
        return state;
    }

    it("wins every flip → draws two cards for each flip, and never flips past the chosen number", () => {
        const state = castAndChoose(31, 3); // W W W — stops at 3
        expect(state.players[0].hand).toHaveLength(6);
        expect(state.players[0].library).toHaveLength(14);
        // SURFACE: what the caster's client receives through the reducer.
        const view = projectPublicState(state, 1, "p1");
        expect(view.players[0].hand).toHaveLength(6);
        expect(view.players[0].library).toMatchObject({ count: 14 });
        // The opponent sees six cards arrive, not which.
        const opp = projectPublicState(state, 1, "p2");
        expect(opp.players[0].hand).toHaveLength(6);
    });

    it("losing a flip draws nothing, and ends the series there", () => {
        const state = castAndChoose(31, 10); // W W W L — stops at the loss
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(20);
    });

    it("a first-flip loss draws nothing", () => {
        const state = castAndChoose(7, 2); // L
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("choosing 0 flips nothing and draws nothing", () => {
        const state = castAndChoose(31, 0);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });
});

describe("coinFlipSeries validation (ADR 0144)", () => {
    const errorsOf = (effects: EffectOp[]) =>
        validateEffectScript({
            id: "test-flipseries-validate",
            name: "test-flipseries-validate",
            effects,
        });

    it("accepts the shipped card", () => {
        expect(validateEffectScript(squeesRevenge)).toEqual([]);
    });

    it("rejects a series with neither a count nor untilLoss — it has no end", () => {
        const errors = errorsOf([
            { op: "coinFlipSeries", bindFlips: "$f" },
            { op: "draw", player: "controller", count: { ref: "$f" } },
        ]);
        expect(errors.join("\n")).toMatch(/"count" or "untilLoss"/);
    });

    it("rejects a series that binds nothing", () => {
        const errors = errorsOf([{ op: "coinFlipSeries", count: 3 }]);
        expect(errors.join("\n")).toMatch(/at least one of "bindFlips"/);
    });

    it("rejects binding the same name twice", () => {
        const errors = errorsOf([
            {
                op: "coinFlipSeries",
                count: 3,
                bindFlips: "$f",
                bindWins: "$f",
            },
        ]);
        expect(errors.join("\n")).toMatch(/same name twice/);
    });

    it("its counts are NUMBER bindings: a scaled bare ref reads them, a snapshot name does not", () => {
        expect(
            errorsOf([
                { op: "coinFlipSeries", count: 2, bindWins: "$w" },
                {
                    op: "draw",
                    player: "controller",
                    count: { scaled: { value: { ref: "$w" }, times: 2 } },
                },
            ])
        ).toEqual([]);
        const errors = errorsOf([
            {
                op: "choice",
                kind: "discard-hand",
                player: "controller",
                zone: "hand",
                count: 1,
                prompt: "Discard a card.",
                bind: "$picked",
            },
            {
                op: "draw",
                player: "controller",
                count: { scaled: { value: { ref: "$picked" }, times: 2 } },
            },
        ]);
        expect(errors.length).toBeGreaterThan(0);
    });
});
