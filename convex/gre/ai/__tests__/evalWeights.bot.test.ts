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
import { DEFAULT_EVAL_WEIGHTS, rewardPerMarginPoint } from "../evalWeights";
import { resolveEvalWeights } from "../searchVariant";
import { evaluate, materialMargin } from "../../evaluate";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import { island } from "../../../cards/sets/lea/colorless";

describe("DEFAULT_EVAL_WEIGHTS (issue #2683)", () => {
    it("is byte-for-byte the production values this refactor extracted", () => {
        // One literal per field, deliberately spelled out rather than
        // constructed — a copy-paste from this object back into itself would
        // pass vacuously; this is typed by hand against the PR's own map.
        expect(DEFAULT_EVAL_WEIGHTS).toEqual({
            winScore: 1_000_000,
            lifeWeight: 8,
            // CR 104.3c / 704.5b — the decking pair, added with the `library`
            // eval term. Narrow support: the term is exactly zero at or above
            // `deckingHorizon`, so these move no position that is not near a
            // deck-out.
            deckingHorizon: 12,
            deckingWeight: 1.5,
            // CR 702.138 — the graveyard-as-resource pair, added with the
            // `graveyard` eval term. Zero contribution unless a controlled
            // permanent declares `grantsEscapeToOwnGraveyard`.
            graveyardEngineWeight: 60,
            graveyardEngineCap: 5,
            permanentWeight: 5,
            manaWeight: 12,
            manaDevWeight: 12,
            flexWeight: 6,
            flexCardCap: 3,
            sourceBreadthWeight: 4,
            sourceDualPurposeWeight: 20,
            blockCautionFraction: 0.5,
            ucbC: 1.4,
            reactivePriorC: 0.5,
            rolloutEpsilon: 0.25,
            rolloutEpsilonReactive: 0.05,
            rolloutGuardrailPenalty: 0.05,
            terminalBand: 0.25,
            materialFull: 500,
            calibratedRewardK: 9.983957e-4,
            comboReward: 0.00003,
            choicePriorC: 0.75,
            visitTol: 0.15,
            outcomeEps: 0.05,
            extraTurnValue: 350,
            misdirectionWeight: 1_000_000,
        });
    });

    it("is frozen — a mutation attempt is a no-op / throws in strict mode", () => {
        expect(Object.isFrozen(DEFAULT_EVAL_WEIGHTS)).toBe(true);
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
        const resolved = resolveEvalWeights({
            name: "mana-heavy",
            evalWeights: { manaWeight: 16 },
        });
        expect(resolved.manaWeight).toBe(16);
        expect(resolved.lifeWeight).toBe(DEFAULT_EVAL_WEIGHTS.lifeWeight);
        // The default vector itself must never be mutated by the merge.
        expect(DEFAULT_EVAL_WEIGHTS.manaWeight).toBe(12);
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
        expect(atDouble - atDefault).toBe(DEFAULT_EVAL_WEIGHTS.manaWeight);
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
