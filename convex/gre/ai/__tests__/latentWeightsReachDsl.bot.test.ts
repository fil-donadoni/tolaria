// `evaluate(state, id, W)` is a function of `W` — ALL of it (issue #3406).
//
// The DSL-derived half of a card's worth (its Effect Script, walked through
// `OP_VALUERS`) used to be priced at the COMMITTED latent vector no matter
// which vector the evaluation was running under: `dslLatentPieces`,
// `dslRealizedAbilityValueById` and `latentGraveyardValue` each built a
// context-free grounding with no weights, and `contextFreeGrounding()` falls
// back to `DEFAULT_EVAL_WEIGHTS.latent`. Two consequences, both silent:
//
//  * a `SearchVariant.evalWeights` ladder arm that lowered, say, `latent.pump`
//    changed the board terms and NOT the script value of the same card;
//  * the Weight Fit's probe — one bumped vector per fittable weight — read a
//    basis of exactly ZERO for those dimensions, so `lifeSwing`, `tokens`,
//    `pump` and `protection` were unfittable, and the fit's own result
//    depended on the vector already committed. A fit that cannot reproduce
//    itself is not a fit (ADR 0124 §3), which is how this surfaced.
//
// So the guard is per SURFACE, not per card: the realized (in-play) half, the
// latent (in-hand) half, and the graveyard half — the third also pins the
// memo, which was keyed by card id alone and therefore handed the first
// vector's answer to every vector after it.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import { evaluateBreakdown } from "../../evaluate";
import { latentGraveyardValue } from "../graveyardReach";
import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";
import { grimLavamancer } from "../../../cards/sets/tor/red";

/** The production vector with ONE latent dimension moved. Everything else —
 *  every scalar weight, every other dimension — is untouched, so a term that
 *  moves can only have moved through the dimension named. */
function withLatent(
    key: keyof EvalWeights["latent"],
    value: number
): EvalWeights {
    return {
        ...DEFAULT_EVAL_WEIGHTS,
        latent: { ...DEFAULT_EVAL_WEIGHTS.latent, [key]: value },
    };
}

/** Grim Lavamancer: a 1/1 body whose whole interest is an activated ability
 *  that deals 2 damage — so `latent.damage` is the dimension its script is
 *  priced in, and the body (a `creatureValueRaw` of a 1/1) is not. */
const LAVAMANCER = grimLavamancer.id;

function stateWith(zone: "battlefield" | "hand" | "graveyard") {
    const card = makeInstance(LAVAMANCER, {
        controllerId: "p1",
        ownerId: "p1",
        zone: zone === "battlefield" ? undefined : zone,
    });
    return {
        card,
        state: makeState({
            players: [
                makePlayer("p1", {
                    [zone]: [card],
                }),
                makePlayer("p2", {}),
            ],
        }),
    };
}

const DOUBLE_DAMAGE = withLatent(
    "damage",
    DEFAULT_EVAL_WEIGHTS.latent.damage * 2
);

describe("the latent vector reaches the DSL-derived worth (issue #3406)", () => {
    it("moves the REALIZED (in-play) ability-script half of the creatures term", () => {
        const { state } = stateWith("battlefield");
        const base = evaluateBreakdown(state, "p1", DEFAULT_EVAL_WEIGHTS).self
            .creatures;
        const bumped = evaluateBreakdown(state, "p1", DOUBLE_DAMAGE).self
            .creatures;
        expect(
            bumped,
            "a creature in play whose worth is an ability script must be priced at the vector the evaluation was CALLED with"
        ).toBeGreaterThan(base);
    });

    it("moves the LATENT (in-hand) ability-script half of the hand term", () => {
        const { state } = stateWith("hand");
        const base = evaluateBreakdown(state, "p1", DEFAULT_EVAL_WEIGHTS).self
            .hand;
        const bumped = evaluateBreakdown(state, "p1", DOUBLE_DAMAGE).self.hand;
        expect(bumped).toBeGreaterThan(base);
    });

    it("moves the graveyard reading, and the memo does not freeze the first vector", () => {
        const { card } = stateWith("graveyard");
        // The production vector FIRST, so a memo keyed by id alone would have
        // this answer cached and would return it again below.
        const base = latentGraveyardValue(card, DEFAULT_EVAL_WEIGHTS.latent);
        const bumped = latentGraveyardValue(card, DOUBLE_DAMAGE.latent);
        expect(
            bumped,
            "the per-id memo must be keyed by the vector too — otherwise every vector reads the first one's price"
        ).toBeGreaterThan(base);
        // And the same vector twice is the same number — determinism, which
        // is what the memo must not break. (It does not prove a cache HIT:
        // a memo-less pure function passes this identically.)
        expect(latentGraveyardValue(card, DEFAULT_EVAL_WEIGHTS.latent)).toBe(
            base
        );
    });
});
