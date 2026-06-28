// Time Spiral (TSP) — colorless card behavior tests (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import { chromaticStar } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

const FOREST = getCardByName("Forest").id;

function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
    } as StackItem);
    resolveTopOfStack(state);
}

describe("Chromatic Star (any-colour sac + dies-cantrip, CR 605 / 603.6c)", () => {
    it("registers with a five-colour mana ability (useStack:false)", () => {
        expect(getCardByName("Chromatic Star")).toBe(chromaticStar);
        expect(chromaticStar.manaCost).toEqual({ X: 1 });
        const mana = chromaticStar.activatedAbilities!.find(
            (a) => a.id === "chromatic-star-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaChoices).toHaveLength(5);
        expect(mana.cost).toMatchObject({ tap: true, sacrifice: true });
    });

    it("draws a card when it is put into a graveyard (leaves-to-graveyard)", () => {
        const star = makeInstance(chromaticStar.id, {
            id: "star",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const lib = [0, 1].map((i) =>
            makeInstance(FOREST, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [star], library: lib }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, star, "chromatic-star-death-draw", {
            type: "PERMANENT_LEFT",
            instanceId: "star",
            controllerId: "p1",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].hand.length).toBe(1);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(1);
    });
});
