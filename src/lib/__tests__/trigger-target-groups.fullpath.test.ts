// Issue #8475 — a trigger's independent target groups, the FULL PATH in one test:
// the GRE raises the walk (`raiseTriggerTargetSelection`) → wire
// (`projectPublicState`) → the client's target highlight
// (`matchesPermanentTargetFilters`) → the accepted pick (`game.ts`'s
// `applyOneTargetSelection`) → the stack item the client reads.
//
// The forced primary group never prompts, so the first selection the client sees
// is the QUEUED group: its filters must have replaced the primary's on the wire.
import { describe, it, expect } from "vitest";
import { matchesPermanentTargetFilters } from "../card-utils";
import type { CardInstance, PendingTarget, Player } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { grizzlyBears } from "@convex/cards/sets/lea/green.cards";
import { withTemporaryDefinition } from "@convex/cards/registry";
import { applyOneTargetSelection } from "@convex/game";
import { raiseTriggerTargetSelection } from "@convex/gre/rules";
import {
    OPPONENT_GROUP,
    groupsCard,
    groupsTrigger,
} from "@convex/gre/__tests__/triggerTargetGroups.helper";

function bear(id: string, controllerId: string) {
    return makeInstance(grizzlyBears().id, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

describe("trigger target groups — GRE → wire → UI → game.ts (issue #8475)", () => {
    it("the client highlights the queued group, the server accepts it, the stack shows both targets", () => {
        const def = groupsCard(OPPONENT_GROUP, [
            {
                type: "Creature",
                count: { min: 0, max: 1 },
                controller: "opponent",
            },
        ]);
        withTemporaryDefinition(def, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [bear("mine", "p1")] }),
                    makePlayer("p2", {
                        battlefield: [bear("a", "p2"), bear("b", "p2")],
                    }),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
            });
            state.stack.push(groupsTrigger());
            expect(raiseTriggerTargetSelection(state)).toBe(true);

            const projected = projectPublicState(state, 1, "p1");
            const players = projected.players as unknown as Player[];
            const pendingTarget =
                projected.pendingTarget as unknown as PendingTarget;
            expect(pendingTarget.kind).toBe("trigger");
            expect(pendingTarget.targetType).toBe("Creature");
            const glows = (id: string) =>
                matchesPermanentTargetFilters(
                    players
                        .flatMap((p) => p.battlefield)
                        .find((c) => c.id === id) as unknown as CardInstance,
                    pendingTarget,
                    players,
                    "p1",
                    undefined
                );
            expect(glows("a")).toBe(true);
            expect(glows("mine")).toBe(false);

            applyOneTargetSelection(state, "p1", {
                targetType: "permanent",
                targetId: "a",
            });

            const after = projectPublicState(state, 2, "p1");
            expect(after.pendingTarget).toBeFalsy();
            expect(after.stack[0].targets).toEqual([
                expect.objectContaining({ type: "player", id: "p2" }),
                expect.objectContaining({ type: "permanent", id: "a" }),
            ]);
        });
    });
});
