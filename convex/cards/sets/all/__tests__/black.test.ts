import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import { collectTriggers } from "../../../../gre/triggers";
import { resolveTopOfStack } from "../../../../gre/state";
import { getDefinition } from "../../../index";

const krovikanHorror = getDefinition("e1f3cb1c-6bde-4b55-b5bc-5b64b56930f2");
const CREATURE_ID = "b93c5869-7777-44bb-967a-e9439b25ced4"; // Ironroot Treefolk
const NON_CREATURE_ID = "9a879b60-4381-447d-8a5a-8e0b6a1d49ca"; // Force of Will

// Krovikan Horror — "At the beginning of the end step, if this card is in your
// graveyard with a creature card directly above it, you may return this card
// to your hand." (CR 513.1a, 603.4, 404.2)
describe("Krovikan Horror (end-step graveyard recursion)", () => {
    const filler = (id: string, defId: string): CardInstanceState =>
        makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });

    // `above` lists the cards stacked over the Horror, bottom to top.
    function gyState(
        above: CardInstanceState[],
        activePlayerId = "p1"
    ): GameState {
        const horror = makeInstance(krovikanHorror.id, {
            id: "horror",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        return makeState({
            activePlayerId,
            phase: "END_STEP",
            players: [
                makePlayer("p1", { graveyard: [horror, ...above] }),
                makePlayer("p2"),
            ],
        });
    }

    const endStep = (activePlayerId: string) => ({
        type: "PHASE_BEGIN" as const,
        phase: "END_STEP" as const,
        activePlayerId,
    });

    it("triggers with a creature card directly above it, on either player's end step", () => {
        for (const active of ["p1", "p2"]) {
            const state = gyState([filler("c1", CREATURE_ID)], active);
            const triggers = collectTriggers(state, [endStep(active)]);
            expect(triggers).toHaveLength(1);
            expect(triggers[0].triggeredAbilityId).toBe(
                "krovikan-horror-end-step-return"
            );
        }
    });

    it("does NOT trigger when the card directly above is not a creature, even with a creature higher", () => {
        const state = gyState([
            filler("n1", NON_CREATURE_ID),
            filler("c1", CREATURE_ID),
        ]);
        expect(collectTriggers(state, [endStep("p1")])).toHaveLength(0);
    });

    it("does NOT trigger when it is the top card of the graveyard", () => {
        expect(collectTriggers(gyState([]), [endStep("p1")])).toHaveLength(0);
    });

    it("returns to hand when the player accepts, stays when declined", () => {
        for (const answer of ["yes", "no"]) {
            const state = gyState([filler("c1", CREATURE_ID)]);
            state.stack.push(...collectTriggers(state, [endStep("p1")]));
            expect(resolveTopOfStack(state)).toBeNull();
            const pending = state.pendingChoices![0];
            const item = state.stack[state.stack.length - 1];
            item.collectedChoices = {
                [`${pending.step}:${pending.choiceId}`]: [answer],
            };
            state.pendingChoices = undefined;
            resolveTopOfStack(state);
            const p1 = state.players[0];
            expect(p1.hand.some((c) => c.id === "horror")).toBe(
                answer === "yes"
            );
            expect(p1.graveyard.some((c) => c.id === "horror")).toBe(
                answer === "no"
            );
        }
    });
});
