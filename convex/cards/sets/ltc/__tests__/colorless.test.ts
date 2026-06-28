// Tales of Middle-earth Commander (LTC) — colorless behavior tests (ADR 0043).
import { describe, it, expect } from "vitest";
import { relicOfSauron } from "../colorless";
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

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
    } as StackItem);
    resolveTopOfStack(state);
}

function answerChoice(state: GameState, picks: string[]): void {
    const head = state.pendingChoices?.[0];
    if (!head) throw new Error("no pending choice to answer");
    const item = state.stack.find((s) => s.id === head.stackItemId)!;
    item.collectedChoices = {
        ...(item.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: picks,
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

describe("Relic of Sauron (Grixis rock + draw-two-discard-one, CR 605 / 608.2)", () => {
    it("has a {U}{B}{R} two-mana ability with six combinations", () => {
        expect(getCardByName("Relic of Sauron")).toBe(relicOfSauron);
        expect(relicOfSauron.manaCost).toEqual({ X: 4 });
        const mana = relicOfSauron.activatedAbilities!.find(
            (a) => a.id === "relic-of-sauron-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaChoices).toHaveLength(6);
    });

    it("draws two then discards one (net +1 card, +1 in graveyard)", () => {
        const relic = makeInstance(relicOfSauron.id, {
            id: "relic",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lib = [0, 1, 2].map((i) =>
            makeInstance(FOREST, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [relic], library: lib }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, relic, "relic-of-sauron-draw");
        // Step 0 drew two; the discard choice suspends the resolution.
        expect(state.players[0].hand.length).toBe(2);
        answerChoice(state, [state.players[0].hand[0].id]);
        expect(state.players[0].hand.length).toBe(1);
        expect(state.players[0].graveyard.length).toBe(1);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(1);
    });
});
