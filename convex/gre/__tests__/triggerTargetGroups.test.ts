// CR 603.3d — "The remainder of the process for putting a triggered ability on
// the stack is identical to the process for casting a spell listed in rules
// 601.2c–d. If a choice is required when the triggered ability goes on the stack
// but no legal choices can be made for it ... the ability is simply removed from
// the stack." A trigger's INDEPENDENT target groups (CR 601.2c) are announced in
// declaration order onto the stack item's flat `targets` (issue #8475).
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { TargetRequirement } from "../../cards/types";
import {
    applyOneTargetSelection,
    advanceTargetGroupOrFinalize,
    cancelTriggerTargetSelection,
} from "../../game";
import { raiseTriggerTargetSelection } from "../rules";
import { resolveTopOfStack } from "../state";
import type { GameState } from "../state";
import {
    OPPONENT_GROUP,
    UP_TO_ONE_CREATURE,
    groupsCard,
    groupsTrigger,
} from "./triggerTargetGroups.helper";

const OPPONENT = { type: "player", id: "p2" };
const CREATURE: TargetRequirement = { type: "Creature", count: 1 };

function bear(id: string, controllerId: string) {
    return makeInstance(grizzlyBears().id, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

/** `mine` on p1's side, `theirs` on p2's; the trigger on the stack. */
function board(mine: string[], theirs: string[]): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: mine.map((i) => bear(i, "p1")) }),
            makePlayer("p2", { battlefield: theirs.map((i) => bear(i, "p2")) }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    state.stack.push(groupsTrigger());
    return state;
}

function withGroups<T>(
    primary: TargetRequirement,
    additional: TargetRequirement[],
    fn: () => T
): T {
    return withTemporaryDefinition(groupsCard(primary, additional), fn);
}

function pick(state: GameState, id: string) {
    applyOneTargetSelection(state, "p1", {
        targetType: "permanent",
        targetId: id,
    });
}

const becameTarget = (state: GameState) =>
    (state.pendingEvents ?? []).filter((e) => e.type === "BECAME_TARGET");

describe("trigger target groups — announcement (CR 603.3d, CR 601.2c)", () => {
    it("the sole-target auto-select of the primary group does not skip the queued group", () => {
        const state = board([], ["a", "b"]);
        withGroups(OPPONENT_GROUP, [UP_TO_ONE_CREATURE], () => {
            expect(raiseTriggerTargetSelection(state)).toBe(true);
            expect(state.pendingTarget?.kind).toBe("trigger");
            expect(state.pendingTarget?.priorSelected).toEqual([
                expect.objectContaining(OPPONENT),
            ]);
            expect(state.pendingTarget?.targetType).toBe("Creature");
            expect(state.stack[0].targets).toBeUndefined();
            expect(state.priorityPlayerId).toBe("p1");
        });
    });

    it("locks both groups positionally and the script reads each slot", () => {
        const state = board([], ["a", "b"]);
        withGroups(OPPONENT_GROUP, [UP_TO_ONE_CREATURE], () => {
            raiseTriggerTargetSelection(state);
            pick(state, "b");
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0].targets).toEqual([
                expect.objectContaining(OPPONENT),
                expect.objectContaining({ type: "permanent", id: "b" }),
            ]);
            const lifeBefore = state.players[1].life;
            resolveTopOfStack(state);
            expect(state.players[1].life).toBe(lifeBefore - 1);
            expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
                "a",
            ]);
        });
    });

    it("CR 608.2b — the primary group's filters are not applied to a later group's target at resolution", () => {
        const state = board(["mine"], ["theirs"]);
        withGroups(
            { type: "Creature", count: 1, controller: "you" },
            [{ type: "Creature", count: 1, controller: "opponent" }],
            () => {
                raiseTriggerTargetSelection(state);
                resolveTopOfStack(state);
                expect(state.players[1].battlefield).toEqual([]);
            }
        );
    });

    it("a real choice in the primary group queues the later one", () => {
        const state = board(["mine"], ["theirs"]);
        withGroups(CREATURE, [{ type: "player", count: 1 }], () => {
            expect(raiseTriggerTargetSelection(state)).toBe(true);
            expect(state.pendingTarget?.remainingRequirements).toHaveLength(1);
            pick(state, "mine");
            expect(state.pendingTarget?.targetType).toBe("player");
            expect(state.pendingTarget?.priorSelected).toEqual([
                expect.objectContaining({ id: "mine" }),
            ]);
        });
    });

    it("every locked target emits a became-target event, as a trigger's", () => {
        const state = board([], ["a", "b"]);
        withGroups(OPPONENT_GROUP, [UP_TO_ONE_CREATURE], () => {
            raiseTriggerTargetSelection(state);
            expect(becameTarget(state)).toHaveLength(0);
            pick(state, "a");
            const events = becameTarget(state);
            expect(events.map((e) => e.target.id)).toEqual(["p2", "a"]);
            expect(new Set(events.map((e) => e.sourceKind))).toEqual(
                new Set(["triggered-ability"])
            );
        });
    });

    it("a fully forced announcement locks every group and fires an event for each, with no prompt", () => {
        const state = board([], ["a"]);
        withGroups(OPPONENT_GROUP, [CREATURE], () => {
            expect(raiseTriggerTargetSelection(state)).toBe(false);
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0].targets).toEqual([
                expect.objectContaining(OPPONENT),
                expect.objectContaining({ id: "a" }),
            ]);
            expect(becameTarget(state).map((e) => e.target.id)).toEqual([
                "p2",
                "a",
            ]);
        });
    });
});

describe("trigger target groups — an empty optional group (CR 603.3d, CR 608.2b)", () => {
    it("with nothing legal it stays on the stack without that target, and { target: 1 } resolves to nothing", () => {
        const state = board([], []);
        withGroups(OPPONENT_GROUP, [UP_TO_ONE_CREATURE], () => {
            expect(raiseTriggerTargetSelection(state)).toBe(false);
            expect(state.stack[0].targets).toEqual([
                expect.objectContaining(OPPONENT),
            ]);
            const lifeBefore = state.players[1].life;
            resolveTopOfStack(state);
            expect(state.players[1].life).toBe(lifeBefore - 1);
        });
    });

    it("an optional PRIMARY group with nothing legal still walks the queue", () => {
        const state = board([], []);
        withGroups(UP_TO_ONE_CREATURE, [OPPONENT_GROUP], () => {
            expect(raiseTriggerTargetSelection(state)).toBe(false);
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0].targets).toEqual([
                expect.objectContaining(OPPONENT),
            ]);
        });
    });

    it("declining it by confirming locks the earlier groups' picks only", () => {
        const state = board([], ["a"]);
        withGroups(OPPONENT_GROUP, [UP_TO_ONE_CREATURE], () => {
            raiseTriggerTargetSelection(state);
            advanceTargetGroupOrFinalize(state, state.pendingTarget!, "p1");
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0].targets).toEqual([
                expect.objectContaining(OPPONENT),
            ]);
            expect(becameTarget(state).map((e) => e.target.id)).toEqual(["p2"]);
        });
    });

    it("cancelling it declines that group and keeps the earlier picks", () => {
        const state = board([], ["a"]);
        withGroups(OPPONENT_GROUP, [UP_TO_ONE_CREATURE], () => {
            raiseTriggerTargetSelection(state);
            cancelTriggerTargetSelection(state);
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0].targets).toEqual([
                expect.objectContaining(OPPONENT),
            ]);
        });
    });

    it("cancelling an optional primary group still walks the queued group", () => {
        const state = board(["a", "b"], []);
        withGroups(UP_TO_ONE_CREATURE, [CREATURE], () => {
            raiseTriggerTargetSelection(state);
            cancelTriggerTargetSelection(state);
            expect(state.pendingTarget?.count).toBe(1);
            expect(state.stack).toHaveLength(1);
        });
    });
});

describe("trigger target groups — removal (CR 603.3d)", () => {
    it("a required later group with no legal target removes the ability before any prompt", () => {
        const state = board([], []);
        withGroups(OPPONENT_GROUP, [CREATURE], () => {
            expect(raiseTriggerTargetSelection(state)).toBe(false);
            expect(state.stack).toHaveLength(0);
            expect(state.pendingTarget).toBeUndefined();
            expect(becameTarget(state)).toHaveLength(0);
        });
    });

    it("removal also holds when the primary group alone would have prompted", () => {
        const state = board(["a", "b"], []);
        withGroups(
            CREATURE,
            [{ type: "Creature", count: 1, controller: "opponent" }],
            () => {
                expect(raiseTriggerTargetSelection(state)).toBe(false);
                expect(state.stack).toHaveLength(0);
            }
        );
    });

    it("an 'another target' group the forced primary pick empties removes the ability", () => {
        const state = board(["only"], []);
        withGroups(
            CREATURE,
            [{ type: "Creature", count: 1, excludePriorTargets: true }],
            () => {
                expect(raiseTriggerTargetSelection(state)).toBe(false);
                expect(state.stack).toHaveLength(0);
                expect(state.pendingTarget).toBeUndefined();
                expect(becameTarget(state)).toHaveLength(0);
            }
        );
    });

    it("a chosen pick that empties a later required group removes the ability and lands priority", () => {
        const state = board(["mine"], ["theirs"]);
        withGroups(
            CREATURE,
            [
                {
                    type: "Creature",
                    count: 1,
                    controller: "you",
                    excludePriorTargets: true,
                },
            ],
            () => {
                raiseTriggerTargetSelection(state);
                pick(state, "mine");
                expect(state.stack).toHaveLength(0);
                expect(state.pendingTarget).toBeUndefined();
                expect(state.priorityPlayerId).toBe("p1");
            }
        );
    });
});

describe("trigger target groups — later groups read the walk", () => {
    it("'another target' excludes the earlier pick and the sole remaining target auto-locks", () => {
        const state = board(["a", "b"], []);
        withGroups(
            CREATURE,
            [{ type: "Creature", count: 1, excludePriorTargets: true }],
            () => {
                raiseTriggerTargetSelection(state);
                pick(state, "a");
                expect(state.pendingTarget).toBeUndefined();
                expect(state.stack[0].targets).toEqual([
                    expect.objectContaining({ id: "a" }),
                    expect.objectContaining({ id: "b" }),
                ]);
            }
        );
    });

    it("a later group's source directive binds to the trigger's source (CR 603.3d)", () => {
        const state = board(["source", "other"], []);
        withGroups(
            OPPONENT_GROUP,
            [{ type: "Creature", count: 1, excludeSource: true }],
            () => {
                expect(raiseTriggerTargetSelection(state)).toBe(false);
                expect(state.stack[0].targets).toEqual([
                    expect.objectContaining(OPPONENT),
                    expect.objectContaining({ id: "other" }),
                ]);
            }
        );
    });

    it("a prompted later group carries the source-bound filters to the chooser", () => {
        const state = board(["source", "x", "y"], []);
        withGroups(
            OPPONENT_GROUP,
            [{ type: "Creature", count: 1, excludeSource: true }],
            () => {
                raiseTriggerTargetSelection(state);
                expect(state.pendingTarget?.excludeInstanceIds).toEqual([
                    "source",
                ]);
            }
        );
    });

    it("a prompted later group binds a sourcePower bound to the source's live power", () => {
        const state = board(["source", "x", "y"], []);
        withGroups(
            OPPONENT_GROUP,
            [
                {
                    type: "Creature",
                    count: 1,
                    mvFilter: { max: "sourcePower" },
                },
            ],
            () => {
                raiseTriggerTargetSelection(state);
                expect(state.pendingTarget?.mvFilter).toEqual({ max: 2 });
            }
        );
    });

    it("chains to the next trigger of the batch once the walk finishes", () => {
        const state = board([], ["a", "b"]);
        state.stack.unshift(groupsTrigger("t0"));
        withGroups(OPPONENT_GROUP, [UP_TO_ONE_CREATURE], () => {
            raiseTriggerTargetSelection(state);
            expect(state.pendingTarget?.cardInstanceId).toBe("t1");
            pick(state, "a");
            expect(state.pendingTarget?.cardInstanceId).toBe("t0");
            expect(state.pendingTarget?.priorSelected).toEqual([
                expect.objectContaining(OPPONENT),
            ]);
        });
    });
});
