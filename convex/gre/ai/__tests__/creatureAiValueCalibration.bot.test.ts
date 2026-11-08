// A creature `aiValue` override replaces the WHOLE latent worth outright, so a
// scalar cannot follow the fitted `latentCreatureDiscount` by itself (issue
// #5012: three overrides were hand-tuned against the removed fixed 0.85 and sat
// ~40% high at the fitted ~0.55; issue #7744: a base-side refit moved the
// discount and red the base until the literals were re-typed by hand). An
// override whose magnitude is "discounted body + premium" therefore declares
// the body and the premium as DATA, and `latentValue` resolves it against the
// discount of the weights doing the valuing. This pins the RESOLUTION: the
// worth follows a moved discount, so no source literal can go stale.
import { describe, expect, it } from "vitest";
import { phantasmalImage } from "../../../cards/sets/m12/blue.cards";
import { mirrorwoodTreefolk } from "../../../cards/sets/pls/green.cards";
import { meddlingMage } from "../../../cards/sets/pls/multicolor.cards";
import { cardValueById } from "../../cardValue";
import { creatureValueRaw } from "../../creatureBody";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";

const CASES = [
    // body = a representative 2/2 at MV2 (the copied body is unknowable).
    { def: phantasmalImage(), body: [2, 2, 2], premium: 0 },
    // vanilla 2/4 MV4 + 25 for the repeatable redirect.
    { def: mirrorwoodTreefolk(), body: [2, 4, 4], premium: 25 },
    // 2/2 MV2 + 7 for the soft Duress-grade disruption.
    { def: meddlingMage(), body: [2, 2, 2], premium: 7 },
] as const;

/** Two discounts far enough apart that a frozen literal cannot match both. */
const LOW = { creature: 0.5, flash: 0.6 };
const HIGH = { creature: 0.8, flash: 0.9 };

describe("creature aiValue overrides resolve against the live discount (issues #5012, #7744)", () => {
    for (const { def, body, premium } of CASES) {
        const [p, t, mv] = body;
        const raw = creatureValueRaw(p, t, mv, []);

        it(`${def.name}: latent worth = committed discount × body + ${premium}`, () => {
            const derived =
                DEFAULT_EVAL_WEIGHTS.latentCreatureDiscount * raw + premium;
            expect(
                Math.abs(cardValueById(def.id) - derived)
            ).toBeLessThanOrEqual(1);
        });

        it(`${def.name}: a moved discount moves its latent worth with the body`, () => {
            const low = cardValueById(def.id, undefined, "hand", LOW);
            const high = cardValueById(def.id, undefined, "hand", HIGH);
            expect(low).toBeCloseTo(LOW.creature * raw + premium, 6);
            expect(high).toBeCloseTo(HIGH.creature * raw + premium, 6);
        });
    }
});
