// CR 707.10c / 115.7a — a copy (or a retargeted spell) keeps ALL of the spell's
// target groups: the retarget prompt walks every group, and finalization
// writes the whole list, not just the primary group's picks.
import { describe, it, expect } from "vitest";
import {
    makeState,
    makePlayer,
    makeInstance,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import { offerRetargetUnlessForced, requestCopyRetargetOn } from "../state";
import { applyOneTargetSelection } from "../../game";

const fumarole = getDefinition("efa53e9a-0d7c-4d17-b2be-56930edfa2c2");
const bears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const mountain = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56");

function board(creatures: string[], lands: string[]) {
    const mk = (id: string, cardId: string) =>
        makeInstance(cardId, {
            id,
            controllerId: "p2",
            ownerId: "p2",
        });
    return makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: [
                    ...creatures.map((id) => mk(id, bears.id)),
                    ...lands.map((id) => mk(id, mountain.id)),
                ],
            }),
        ],
    });
}

describe("copy retarget walks every target group (CR 707.10c)", () => {
    it("Fumarole copy: prompts creature, then land, and keeps both picks", () => {
        const state = board(["bear1", "bear2"], ["land1", "land2"]);
        const copy = pushSpell(state, fumarole.id, "p1", [
            { type: "permanent", id: "bear1" },
            { type: "permanent", id: "land1" },
        ]);
        requestCopyRetargetOn(state, copy);
        expect(state.pendingTarget?.kind).toBe("copy-retarget");
        expect(state.pendingTarget?.remainingRequirements).toHaveLength(1);

        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "bear2",
        });
        // Group 0 done -> the land group loads, the selection stays open.
        expect(state.pendingTarget).toBeDefined();
        expect(state.pendingTarget?.priorSelected).toEqual([
            { type: "permanent", id: "bear2" },
        ]);
        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "land2",
        });
        expect(state.pendingTarget).toBeUndefined();
        expect(copy.targets).toEqual([
            { type: "permanent", id: "bear2" },
            { type: "permanent", id: "land2" },
        ]);
    });

    it("offers the prompt when only a later group has an alternative", () => {
        const state = board(["bear1"], ["land1", "land2"]);
        const copy = pushSpell(state, fumarole.id, "p1", [
            { type: "permanent", id: "bear1" },
            { type: "permanent", id: "land1" },
        ]);
        offerRetargetUnlessForced(state, copy);
        expect(state.pendingTarget?.remainingRequirements).toHaveLength(1);
    });

    it("keeps the inherited targets when no group has an alternative", () => {
        const state = board(["bear1"], ["land1"]);
        const copy = pushSpell(state, fumarole.id, "p1", [
            { type: "permanent", id: "bear1" },
            { type: "permanent", id: "land1" },
        ]);
        offerRetargetUnlessForced(state, copy);
        expect(state.pendingTarget).toBeUndefined();
    });
});
