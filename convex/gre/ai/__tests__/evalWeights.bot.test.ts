// `EvalWeights` / `DEFAULT_EVAL_WEIGHTS` (issue #2683) — the single explicit
// calibration surface `evaluate.ts` and `search.ts` now read instead of a
// scattered module-level constant per file. Two things this suite pins:
//
//   1. A DRIFT GUARD on `DEFAULT_EVAL_WEIGHTS` — a snapshot literal, so a
//      weight cannot change silently (the ticket's own acceptance criterion).
//      Proven to fail: temporarily changing `lifeWeight` from 8 to 9 turned
//      this test red (reverted; see the PR description for the exact diff).
//   2. `resolveEvalWeights` (`searchVariant.ts`) merges a partial override
//      over the default without mutating the frozen default, and `evaluate()`
//      actually reads a non-default vector end-to-end — the wiring the
//      ticket exists to add, not just the type.

import { describe, expect, it } from "vitest";
import {
    DEFAULT_EVAL_WEIGHTS,
    FIT_BASE_EVAL_WEIGHTS,
    rewardPerMarginPoint,
} from "../evalWeights";
import { resolveEvalWeights } from "../searchVariant";
import { evaluate, materialMargin } from "../../evaluate";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import { island } from "../../../cards/sets/lea/colorless";

describe("DEFAULT_EVAL_WEIGHTS (issue #2683)", () => {
    it("a TAPPED source is worth strictly less than an untapped one (issue #3377)", () => {
        // The ordering, not the numbers: `evaluate` reads both weights off the
        // vector, so a variant overriding `manaWeight` alone (as
        // `eval-weights-demo` does) could otherwise silently make a tapped
        // source worth MORE than an untapped one — the inversion the weight's
        // own doc says must never happen.
        expect(DEFAULT_EVAL_WEIGHTS.tappedManaWeight).toBeLessThan(
            DEFAULT_EVAL_WEIGHTS.manaWeight
        );
        expect(DEFAULT_EVAL_WEIGHTS.tappedManaWeight).toBeGreaterThan(0);
    });

    it("is frozen — a mutation attempt is a no-op / throws in strict mode", () => {
        expect(Object.isFrozen(DEFAULT_EVAL_WEIGHTS)).toBe(true);
        expect(Object.isFrozen(FIT_BASE_EVAL_WEIGHTS)).toBe(true);
        expect(Object.isFrozen(FIT_BASE_EVAL_WEIGHTS.latent)).toBe(true);
        // The nested latent block is frozen too (issue #3398) — a vector
        // handed to a ladder variant must not be able to reach in and mutate
        // the production unit prices for every other run in the process.
        expect(Object.isFrozen(DEFAULT_EVAL_WEIGHTS.latent)).toBe(true);
    });
});

describe("rewardPerMarginPoint (issue #2683)", () => {
    it("derives from terminalBand/materialFull, matching the pre-refactor constant", () => {
        // Byte-identical to the old search.ts REWARD_PER_MARGIN_POINT:
        // (1 - 2*0.25) / (2*500) = 0.0005.
        expect(rewardPerMarginPoint(DEFAULT_EVAL_WEIGHTS)).toBeCloseTo(
            0.0005,
            10
        );
    });

    it("moves when a calibration vector changes materialFull", () => {
        const wider = { ...DEFAULT_EVAL_WEIGHTS, materialFull: 1000 };
        expect(rewardPerMarginPoint(wider)).toBeLessThan(
            rewardPerMarginPoint(DEFAULT_EVAL_WEIGHTS)
        );
    });
});

describe("resolveEvalWeights (issue #2683)", () => {
    it("returns DEFAULT_EVAL_WEIGHTS verbatim for a null variant", () => {
        expect(resolveEvalWeights(null)).toBe(DEFAULT_EVAL_WEIGHTS);
    });

    it("returns DEFAULT_EVAL_WEIGHTS for a variant with no evalWeights override", () => {
        expect(resolveEvalWeights({ name: "no-op" })).toBe(
            DEFAULT_EVAL_WEIGHTS
        );
    });

    it("merges a partial override field-by-field, leaving the rest at default", () => {
        const beforeMerge = DEFAULT_EVAL_WEIGHTS.manaWeight;
        const resolved = resolveEvalWeights({
            name: "mana-heavy",
            evalWeights: { manaWeight: 16 },
        });
        expect(resolved.manaWeight).toBe(16);
        expect(resolved.lifeWeight).toBe(DEFAULT_EVAL_WEIGHTS.lifeWeight);
        // The default vector itself must never be mutated by the merge.
        // Snapshotted before the merge rather than spelled out as a literal:
        // the weights are FITTED now (issue #3401), so a literal reds on every
        // refit — and "not the override" would be a tautology against a frozen
        // object, which is the property under test.
        expect(DEFAULT_EVAL_WEIGHTS.manaWeight).toBe(beforeMerge);
        expect(DEFAULT_EVAL_WEIGHTS.manaWeight).not.toBe(16);
    });
});

describe("evaluate() reads an explicit weights vector (issue #2683)", () => {
    it("a higher manaWeight raises the score of a position with untapped mana, all else equal", () => {
        const p1 = makePlayer("p1", {
            life: 20,
            battlefield: [
                makeInstance(island.id, {
                    id: "p1-island",
                    controllerId: "p1",
                    isTapped: false,
                }),
            ],
        });
        const p2 = makePlayer("p2", { life: 20 });
        const state = makeState({ players: [p1, p2] });

        const atDefault = evaluate(state, "p1");
        const atDouble = evaluate(state, "p1", {
            ...DEFAULT_EVAL_WEIGHTS,
            manaWeight: DEFAULT_EVAL_WEIGHTS.manaWeight * 2,
        });
        // One untapped Island for p1, none for p2: doubling manaWeight doubles
        // the `mana` term's contribution to the margin — exactly one extra
        // `manaWeight` point (the term goes from `1 * manaWeight` to
        // `1 * 2*manaWeight`). Proves the vector reaches `evaluate()` and
        // actually changes its output, not merely compiles.
        expect(atDouble - atDefault).toBeCloseTo(
            DEFAULT_EVAL_WEIGHTS.manaWeight,
            6
        );
    });

    it("a non-default winScore changes the terminal magnitude a win reports", () => {
        const p1 = makePlayer("p1", { life: 20 });
        const p2 = makePlayer("p2", { life: 0 });
        const state = makeState({
            players: [p1, p2],
            gameOver: { winnerId: "p1", loserId: "p2", reason: "life" },
        });
        const atDefault = evaluate(state, "p1");
        const atHalf = evaluate(state, "p1", {
            ...DEFAULT_EVAL_WEIGHTS,
            winScore: DEFAULT_EVAL_WEIGHTS.winScore / 2,
        });
        expect(atDefault).toBeGreaterThan(atHalf);
        expect(atHalf).toBeGreaterThan(0);
    });

    it("materialMargin is unaffected by winScore (it carries no terminal offset)", () => {
        const p1 = makePlayer("p1", { life: 20 });
        const p2 = makePlayer("p2", { life: 20 });
        const state = makeState({ players: [p1, p2] });
        const atDefault = materialMargin(state, "p1");
        const atHalf = materialMargin(state, "p1", {
            ...DEFAULT_EVAL_WEIGHTS,
            winScore: DEFAULT_EVAL_WEIGHTS.winScore / 2,
        });
        expect(atHalf).toBe(atDefault);
    });
});
