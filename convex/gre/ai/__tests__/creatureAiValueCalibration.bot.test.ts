// A creature `aiValue` override replaces the WHOLE latent worth outright, so
// it cannot follow the fitted `latentCreatureDiscount` by itself (issue #5012:
// three overrides were hand-tuned against the removed fixed 0.85 and sat ~40%
// high at the fitted ~0.55). This pins each to "discounted body + the stated
// ability premium" at the COMMITTED discount: a refit that moves the discount
// reds here, naming the override to re-derive.
import { describe, expect, it } from "vitest";
import { phantasmalImage } from "../../../cards/sets/m12/blue.cards";
import { mirrorwoodTreefolk } from "../../../cards/sets/pls/green.cards";
import { meddlingMage } from "../../../cards/sets/pls/multicolor.cards";
import { creatureValueRaw } from "../../creatureBody";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";

/** Allowed drift in Forge points between an override and its derivation. */
const TOLERANCE = 1;

const CASES = [
    // body = a representative 2/2 at MV2 (the copied body is unknowable).
    { def: phantasmalImage, body: [2, 2, 2], premium: 0 },
    // vanilla 2/4 MV4 + 25 for the repeatable redirect.
    { def: mirrorwoodTreefolk, body: [2, 4, 4], premium: 25 },
    // 2/2 MV2 + 7 for the soft Duress-grade disruption.
    { def: meddlingMage, body: [2, 2, 2], premium: 7 },
] as const;

describe("creature aiValue overrides track the fitted discount (issue #5012)", () => {
    for (const { def, body, premium } of CASES) {
        it(`${def.name}: aiValue = discount × body + ${premium}`, () => {
            const [p, t, mv] = body;
            const derived =
                DEFAULT_EVAL_WEIGHTS.latentCreatureDiscount *
                    creatureValueRaw(p, t, mv, []) +
                premium;
            expect(
                Math.abs((def.aiValue ?? NaN) - derived)
            ).toBeLessThanOrEqual(TOLERANCE);
        });
    }
});
