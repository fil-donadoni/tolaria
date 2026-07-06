// ULG — white card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { motherOfRunes } from "../white";
import { balduvianBears } from "../../ice";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import type { CardInstanceState, GameState, StackItem } from "../../../../gre/state";

/** Push an activated ability onto the stack with its cost assumed already
 *  paid, then resolve it (mirrors post-activateAbility state). */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

/** Submit the current head option-pick choice by mode id. */
function submitOption(state: GameState, modeId: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [modeId],
    });
}

// Mother of Runes — {W} Creature — Human Cleric (CR 702.16 protection;
// CR 613.1f temporary keyword grant; CR 700.2 modal color choice).
describe("Mother of Runes (CR 702.16 protection; CR 700.2 color choice)", () => {
    function setup() {
        const mother = makeInstance(motherOfRunes.id, {
            id: "mother",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "t",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mother, target] }),
                makePlayer("p2"),
            ],
        });
        return { state, mother, target };
    }

    it("shape: {W} 1/1 with a single {T} activated ability", () => {
        expect(motherOfRunes.manaCost).toEqual({ W: 1 });
        expect(motherOfRunes.power).toBe(1);
        expect(motherOfRunes.toughness).toBe(1);
        expect(motherOfRunes.activatedAbilities).toHaveLength(1);
        expect(motherOfRunes.activatedAbilities![0].cost).toEqual({
            tap: true,
        });
    });

    it("grants the chosen color's protection to the target until end of turn", () => {
        const { state, mother } = setup();
        resolveActivated(state, mother, "mother-of-runes-protect", [
            { type: "permanent", id: "t" },
        ]);
        // suspends on the color-pick
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("option-pick");
        submitOption(state, "protection-black");
        const target = state.players[0].battlefield.find(
            (c) => c.id === "t"
        )!;
        expect(target.staticAbilities).toContain("protection from black");
    });

    it("can target itself (no self-exclusion in the oracle text)", () => {
        const { state, mother } = setup();
        resolveActivated(state, mother, "mother-of-runes-protect", [
            { type: "permanent", id: "mother" },
        ]);
        submitOption(state, "protection-red");
        const self = state.players[0].battlefield.find(
            (c) => c.id === "mother"
        )!;
        expect(self.staticAbilities).toContain("protection from red");
    });
});
