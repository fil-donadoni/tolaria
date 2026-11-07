// eoe (Edge of Eternities) — white behavior tests (ADR 0043 colour split).
//
// Haliya, Guided by Light (issue #8652): the enter trigger's creature-or-artifact
// filter, and the end-step draw whose "if" is asked once, on resolution — it is
// inside the effect, not an intervening if (CR 603.4).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import type { PermanentEnteredEvent } from "../../../types";
import { preloadDefinitions } from "../../../index";
import { haliyaGuidedByLight } from "../white.cards";

preloadDefinitions([haliyaGuidedByLight()]);

function board(lifeGained = 0) {
    const haliya = makeInstance(haliyaGuidedByLight().id, {
        id: "haliya",
        controllerId: "p1",
        ownerId: "p1",
    });
    const libraryCard = makeInstance(haliyaGuidedByLight().id, {
        id: "lib",
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
    });
    const state = makeState({
        phase: "END_STEP",
        activePlayerId: "p1",
        turn: 3,
        players: [
            makePlayer("p1", { battlefield: [haliya], library: [libraryCard] }),
            makePlayer("p2"),
        ],
    });
    state.lifeGainedThisTurn = { p1: lifeGained };
    return state;
}

function entered(
    instanceId: string,
    controllerId: string,
    types: string[]
): PermanentEnteredEvent {
    return {
        type: "PERMANENT_ENTERED",
        instanceId,
        controllerId,
        types,
    } as PermanentEnteredEvent;
}

const lifeTriggers = (state: GameState, event: PermanentEnteredEvent) =>
    collectTriggers(state, [event]).filter(
        (t) => t.triggeredAbilityId === "haliya-enters-gain-life"
    );

const endStep = (playerId: string) => ({
    type: "PHASE_BEGIN" as const,
    phase: "END_STEP" as const,
    activePlayerId: playerId,
});

const drawTriggers = (state: GameState, playerId = "p1") =>
    collectTriggers(state, [endStep(playerId) as never]).filter(
        (t) => t.triggeredAbilityId === "haliya-end-step-draw"
    );

describe("Haliya, Guided by Light (CR 603.2, CR 603.4)", () => {
    it("gains 1 on herself entering, and on your creature or artifact", () => {
        const state = board();
        for (const [id, types] of [
            ["haliya", ["Creature"]],
            ["bear", ["Creature"]],
            ["mox", ["Artifact"]],
        ] as const)
            expect(
                lifeTriggers(state, entered(id, "p1", [...types]))
            ).toHaveLength(1);
        state.stack.push(
            ...lifeTriggers(state, entered("mox", "p1", ["Artifact"]))
        );
        const life = state.players[0].life;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(life + 1);
    });

    it("ignores a land of yours and an opponent's creature", () => {
        const state = board();
        expect(
            lifeTriggers(state, entered("land", "p1", ["Land"]))
        ).toHaveLength(0);
        expect(
            lifeTriggers(state, entered("foe", "p2", ["Creature"]))
        ).toHaveLength(0);
    });

    it("draws at YOUR end step with exactly 3 life gained", () => {
        const state = board(3);
        expect(drawTriggers(state, "p2")).toHaveLength(0);
        state.stack.push(...drawTriggers(state));
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib"]);
    });

    it("triggers below 3, but draws nothing: the 'if' is asked on resolution", () => {
        const state = board(2);
        const triggers = drawTriggers(state);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("a gain made after the trigger went on the stack still counts", () => {
        const state = board(2);
        state.stack.push(...drawTriggers(state));
        state.lifeGainedThisTurn = { p1: 3 };
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib"]);
    });
});
