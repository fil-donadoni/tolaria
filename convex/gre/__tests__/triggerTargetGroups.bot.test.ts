// CR 603.3d (issue #8475) — the Bot answers a trigger's target-group walk, one
// group at a time, through the enumerator the real and in-tree paths share: a
// group it could not answer would freeze the game.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { withTemporaryDefinition } from "../../cards/registry";
import { etbAbilityScripts } from "../ai/botReachTarget";
import { enumerateMoves } from "../moves";
import { raiseTriggerTargetSelection } from "../rules";
import { applyMoveInSearch } from "../search";
import type { GameState } from "../state";
import {
    OPPONENT_GROUP,
    UP_TO_ONE_CREATURE,
    groupsCard,
    groupsTrigger,
} from "./triggerTargetGroups.helper";

function board(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: ["a", "b"].map((id) =>
                    makeInstance(grizzlyBears().id, {
                        id,
                        controllerId: "p2",
                        ownerId: "p2",
                    })
                ),
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    state.stack.push(groupsTrigger());
    return state;
}

describe("trigger target groups — Bot (CR 603.3d)", () => {
    const def = () => groupsCard(OPPONENT_GROUP, [UP_TO_ONE_CREATURE]);

    it("enumerates the QUEUED group's answers, decline included", () => {
        withTemporaryDefinition(def(), () => {
            const state = board();
            raiseTriggerTargetSelection(state);
            const moves = enumerateMoves(state, "p1");
            const answers = moves.filter((m) => m.kind === "submit-target");
            expect(answers).toHaveLength(moves.length);
            expect(
                answers.map((m) => m.targets.map((t) => t.id)).sort()
            ).toEqual([[], ["a"], ["b"]]);
        });
    });

    it("an in-tree answer commits the flat positional list", () => {
        withTemporaryDefinition(def(), () => {
            const state = board();
            raiseTriggerTargetSelection(state);
            const move = enumerateMoves(state, "p1").find(
                (m) =>
                    m.kind === "submit-target" &&
                    m.targets.some((t) => t.id === "b")
            )!;
            applyMoveInSearch(state, "p1", move);
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0].targets).toEqual([
                expect.objectContaining({ type: "player", id: "p2" }),
                expect.objectContaining({ type: "permanent", id: "b" }),
            ]);
        });
    });

    it("declining in-tree keeps the earlier group's pick", () => {
        withTemporaryDefinition(def(), () => {
            const state = board();
            raiseTriggerTargetSelection(state);
            const move = enumerateMoves(state, "p1").find(
                (m) => m.kind === "submit-target" && m.targets.length === 0
            )!;
            applyMoveInSearch(state, "p1", move);
            expect(state.stack[0].targets).toEqual([
                expect.objectContaining({ type: "player", id: "p2" }),
            ]);
        });
    });

    it("the ETB reach pose sees the ability's later groups, not the card's", () => {
        const [script] = etbAbilityScripts(def());
        expect(script.additionalTargetRequirements).toEqual([
            UP_TO_ONE_CREATURE,
        ]);
    });
});
