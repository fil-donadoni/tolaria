// Time Spiral (TSP) — colorless card behavior tests (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import { chromaticStar } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    getPlayer,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { tapSourceIntoPayment } from "../../../../game";

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

    // CR 605.1a / 601.2f — the mana ability's cost is "{1}, {T}, Sacrifice",
    // so activating it must SPEND {1} from the pool. Chromatic Star nets zero
    // mana — it converts one generic into one of any colour.
    it("charges the {1} activation cost: converts a floated generic into the chosen colour", () => {
        const star = makeInstance(chromaticStar.id, {
            id: "star",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [star],
                    // Float a single red to pay the {1}.
                    manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const p1 = getPlayer(state, "p1");

        // Choice option 2 = {B}. Pays {1} from the red, adds {B}.
        tapSourceIntoPayment(state, p1, star, 2, []);

        expect(p1.manaPool.B).toBe(1);
        expect(p1.manaPool.R).toBe(0);
        // Net zero: exactly one mana in the pool, colour-converted.
        const total = Object.values(p1.manaPool).reduce((a, b) => a + b, 0);
        expect(total).toBe(1);
        expect(p1.graveyard.some((c) => c.id === "star")).toBe(true);
    });

    it("rejects activation when the pool cannot pay the {1} cost", () => {
        const star = makeInstance(chromaticStar.id, {
            id: "star",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                // Empty pool — the {1} is unpayable.
                makePlayer("p1", { battlefield: [star] }),
                makePlayer("p2"),
            ],
        });
        const p1 = getPlayer(state, "p1");

        expect(() => tapSourceIntoPayment(state, p1, star, 0, [])).toThrow(
            /Not enough mana/
        );
        // CR 601.2f — a rejected activation leaves the state untouched: the
        // Star is NOT sacrificed and no mana was produced.
        expect(p1.battlefield.some((c) => c.id === "star")).toBe(true);
        expect(p1.graveyard.some((c) => c.id === "star")).toBe(false);
        const total = Object.values(p1.manaPool).reduce((a, b) => a + b, 0);
        expect(total).toBe(0);
    });
});
