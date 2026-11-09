// Issue #8954 / ADR 0176 — under the `reward-soft-tail` vector the open-band
// reward is strictly monotone in the leaf margin everywhere, never flat past
// ±`materialFull`; the base vector keeps the hard clip (measured, ADR 0176).
//
// The hard clip this replaces mapped every margin beyond ±`materialFull` to
// the same reward, so a position a few creatures behind (or ahead) made the
// search blind to everything that did not end the game inside the horizon:
// "I draw three" and "the opponent draws three" both scored the band floor,
// and the pick fell to rollout residue. The compressive tail keeps the core
// byte-identical (the slope at margin 0 is what issue #1929's calibrated
// logistic moved, and why it was rejected) and spends the remaining band on a
// tail that approaches, but never reaches, the terminal bands.
import { describe, expect, it } from "vitest";
import {
    DEFAULT_EVAL_WEIGHTS,
    rewardPerMarginPoint,
    terminalMagnitude,
    type EvalWeights,
} from "../ai/evalWeights";
import { LADDER_VARIANTS } from "../ai/searchVariant";
import { rewardFromValue } from "../search";

// The base vector is the hard clip (ADR 0176: the tail is measured, not the
// default); the tail is asserted on the `reward-soft-tail` vector.
const HARD_CLIP: EvalWeights = DEFAULT_EVAL_WEIGHTS;
const W: EvalWeights = {
    ...DEFAULT_EVAL_WEIGHTS,
    ...LADDER_VARIANTS["reward-soft-tail"]!.evalWeights,
    latent: DEFAULT_EVAL_WEIGHTS.latent,
} as EvalWeights;
const KNEE = W.materialLinearShare * W.materialFull;

/** The pre-#8954 open-band map — linear at the core slope, clipped at
 *  ±`materialFull`: the oracle the core must still match. */
function linearClip(v: number, w: EvalWeights): number {
    const x = Math.max(-1, Math.min(1, v / w.materialFull));
    return w.terminalBand + (1 - 2 * w.terminalBand) * (0.5 + 0.5 * x);
}

describe("rewardFromValue — compressive tail (issue #8954)", () => {
    it("is strictly monotone past materialFull on both sides: −900 < −1500 apart, +900 < +1500 apart", () => {
        // The issue's own leaves: the self-draw at ≈ −900 and the misdirected
        // draw at ≈ −1500 must get DIFFERENT rewards, in the right order.
        expect(rewardFromValue(-900, W)).toBeGreaterThan(
            rewardFromValue(-1500, W)
        );
        expect(rewardFromValue(1500, W)).toBeGreaterThan(
            rewardFromValue(900, W)
        );
        // And the hard clip is exactly the blindness: same reward either side.
        expect(rewardFromValue(-900, HARD_CLIP)).toBe(
            rewardFromValue(-1500, HARD_CLIP)
        );
        expect(rewardFromValue(900, HARD_CLIP)).toBe(
            rewardFromValue(1500, HARD_CLIP)
        );
    });

    it("is strictly increasing across the whole open band, up to the terminal magnitude", () => {
        const top = terminalMagnitude(W) - 1;
        let prev = rewardFromValue(-top, W);
        // Geometric steps so the deep tail is sampled as densely (in log
        // margin) as the core: a flat stretch anywhere fails.
        for (let m = -top * 0.999; m < top; m = m < 0 ? m / 1.05 : m * 1.05) {
            if (m < 0 && m > -1) m = 1;
            const r = rewardFromValue(m, W);
            expect(r).toBeGreaterThan(prev);
            prev = r;
        }
    });

    it("keeps the linear core byte-identical to the clip it replaces", () => {
        // Every margin within the knee maps exactly as before: the resolution
        // around 0 that issue #1929's objection protects is untouched.
        for (let m = -KNEE; m <= KNEE; m += KNEE / 50) {
            expect(rewardFromValue(m, W)).toBe(linearClip(m, W));
        }
        // And the core slope is still `rewardPerMarginPoint`.
        const slope =
            (rewardFromValue(KNEE / 2, W) - rewardFromValue(-KNEE / 2, W)) /
            KNEE;
        expect(slope).toBeCloseTo(rewardPerMarginPoint(W), 12);
    });

    it("joins the tail without a kink: the slope just past the knee equals the core slope", () => {
        const h = 1e-3;
        const inside =
            (rewardFromValue(KNEE, W) - rewardFromValue(KNEE - h, W)) / h;
        const outside =
            (rewardFromValue(KNEE + h, W) - rewardFromValue(KNEE, W)) / h;
        expect(outside).toBeCloseTo(inside, 6);
    });

    it("never leaves the open band: the deepest non-terminal leaf still ranks above every loss and below every win", () => {
        const edge = terminalMagnitude(W) - 1;
        const worstOpen = rewardFromValue(-edge, W);
        const bestOpen = rewardFromValue(edge, W);
        // Open band is (terminalBand, 1 − terminalBand), strictly.
        expect(worstOpen).toBeGreaterThan(W.terminalBand);
        expect(bestOpen).toBeLessThan(1 - W.terminalBand);
        // A loss that kept a mountain of material still ranks below it, a win
        // that threw everything away still above it (outcome dominance).
        const richLoss = rewardFromValue(-W.winScore + 100_000, W);
        const poorWin = rewardFromValue(W.winScore - 100_000, W);
        expect(richLoss).toBeLessThan(worstOpen);
        expect(poorWin).toBeGreaterThan(bestOpen);
    });

    it("the base vector (materialLinearShare = 1) IS the historical hard clip", () => {
        expect(HARD_CLIP.materialLinearShare).toBe(1);
        for (const m of [
            -5000, -1500, -600, -500, -250, 0, 250, 500, 600, 1500, 5000,
        ]) {
            expect(rewardFromValue(m, HARD_CLIP)).toBe(
                linearClip(m, HARD_CLIP)
            );
        }
    });
});
