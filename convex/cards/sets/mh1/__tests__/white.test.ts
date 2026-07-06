// MH1 — white card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { giverOfRunes } from "../white";
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

// Giver of Runes — {W} Creature — Kor Cleric (CR 702.16 protection;
// CR 613.1f temporary keyword grant; CR 700.2 modal choice; CR 109.2
// "another" excludes the source itself).
describe("Giver of Runes (CR 702.16 protection incl. colorless; CR 109.2 'another')", () => {
    function setup() {
        const giver = makeInstance(giverOfRunes.id, {
            id: "giver",
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
                makePlayer("p1", { battlefield: [giver, target] }),
                makePlayer("p2"),
            ],
        });
        return { state, giver, target };
    }

    it("shape: {W} 1/2 with a single {T} activated ability", () => {
        expect(giverOfRunes.manaCost).toEqual({ W: 1 });
        expect(giverOfRunes.power).toBe(1);
        expect(giverOfRunes.toughness).toBe(2);
        expect(giverOfRunes.activatedAbilities).toHaveLength(1);
    });

    it("excludes itself from the dynamic target requirement ('another target creature you control')", () => {
        const { state, giver } = setup();
        const ability = giverOfRunes.activatedAbilities![0];
        const dynamicReq = ability.getTargetRequirement!(
            giver as never,
            state as never
        );
        expect(dynamicReq.excludeInstanceIds).toEqual([giver.id]);
        expect(dynamicReq.controller).toBe("you");
    });

    it("grants colorless protection to another target creature until end of turn", () => {
        const { state, giver } = setup();
        resolveActivated(state, giver, "giver-of-runes-protect", [
            { type: "permanent", id: "t" },
        ]);
        expect(state.pendingChoices).toHaveLength(1);
        submitOption(state, "protection-colorless");
        const target = state.players[0].battlefield.find(
            (c) => c.id === "t"
        )!;
        expect(target.staticAbilities).toContain("protection from colorless");
    });

    it("grants a chosen color's protection to another target creature", () => {
        const { state, giver } = setup();
        resolveActivated(state, giver, "giver-of-runes-protect", [
            { type: "permanent", id: "t" },
        ]);
        submitOption(state, "protection-blue");
        const target = state.players[0].battlefield.find(
            (c) => c.id === "t"
        )!;
        expect(target.staticAbilities).toContain("protection from blue");
    });
});
