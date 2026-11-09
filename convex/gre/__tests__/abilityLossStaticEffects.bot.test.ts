// CR 613.1f — the Bot's restriction pricing reads the same battlefield
// collection the attack validator does (`collectAttackRestrictions`), so a
// creature whose own "can't attack" restriction is gone under Humility is no
// longer discounted for it. The suppression is driven through the layer
// system, never a hand-set `abilitiesSuppressedBy`.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { creatureRestrictionDiscount } from "../ai/restrictionPricing";
import { beginLayer7Pass } from "../layers";
import {
    beginApplyingStaticEffects,
    getPlayer,
    recomputeContinuousEffects,
    type CardInstanceState,
    type GameState,
} from "../state";

const HUMILITY = getCardByName("Humility").id;
const SEA_SERPENT = getCardByName("Sea Serpent").id;
const BEARS = getCardByName("Grizzly Bears").id;

function inst(cardId: string, controllerId: string, id: string) {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        id,
        zone: "battlefield",
    });
}

function serpentDiscount(state: GameState): number {
    const serpent = getPlayer(state, "p1").battlefield.find(
        (c: CardInstanceState) => c.id === "serpent"
    )!;
    return creatureRestrictionDiscount(
        state,
        serpent,
        DEFAULT_EVAL_WEIGHTS,
        beginLayer7Pass(state)
    );
}

describe("restriction pricing under ability loss (CR 613.1f)", () => {
    it("Sea Serpent under Humility carries no attack-restriction discount", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [inst(SEA_SERPENT, "p1", "serpent")],
                }),
                makePlayer("p2", { battlefield: [inst(BEARS, "p2", "bears")] }),
            ],
        });
        expect(serpentDiscount(state)).toBeGreaterThan(0);

        const humility = inst(HUMILITY, "p2", "humility");
        getPlayer(state, "p2").battlefield.push(humility);
        beginApplyingStaticEffects(state, humility);
        recomputeContinuousEffects(state);
        expect(serpentDiscount(state)).toBe(0);
    });
});
