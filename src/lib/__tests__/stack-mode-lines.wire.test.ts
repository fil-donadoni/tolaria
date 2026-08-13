// Frontend wire-format test for the stack chosen-mode highlight (issue #1274,
// CR 700.2c). A modal spell that locked in a mode at cast must show its modal
// oracle lines with the chosen one highlighted, to BOTH players — and the
// affordance reads `chosenModeId` off the stack item, which crosses the wire
// via `projectPublicState`. Per the frontend-wiring mandate, the SURFACE
// assertion (`getStackModeLines`) MUST run through the projection: a hand-built
// slim item would mask a dropped field.

import { describe, it, expect } from "vitest";
import { getStackModeLines } from "../card-utils";
import { visionCharm } from "@convex/cards/sets/vis/blue";
import { deceiverExarch } from "@convex/cards/sets/nph/blue";
import { grizzlyBears } from "@convex/cards/sets/lea/green";
import { raiseTriggerTargetSelection } from "@convex/gre/rules";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { blackLotus } from "@convex/cards/sets/lea/colorless";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";

/** Vision Charm on the stack with mode "mill" locked in at cast, as
 *  `announceCast` would leave it (chosenModeId + announced target). */
function stateWithModalOnStack(modeId: string) {
    const lotus = makeInstance(blackLotus.id, {
        id: "lotus",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [lotus] }), makePlayer("p2")],
    });
    const item = pushSpell(state, visionCharm.id, "p1", [
        { type: "player", id: "p2" },
    ]);
    item.chosenModeId = modeId;
    return state;
}

describe("stack chosen-mode highlight survives the wire (issue #1274, CR 700.2c)", () => {
    it("getStackModeLines flags the chosen mode and de-emphasizes the rest — on FAT state", () => {
        const state = stateWithModalOnStack("mill");
        const lines = getStackModeLines(state.stack[0]);
        expect(lines).not.toBeNull();
        expect(lines!.map((l) => l.modeId)).toEqual([
            "mill",
            "land-type",
            "phase",
        ]);
        expect(lines!.filter((l) => l.chosen).map((l) => l.modeId)).toEqual([
            "mill",
        ]);
        const chosen = lines!.find((l) => l.chosen)!;
        expect(chosen.oracleText).toBe("Target player mills four cards.");
    });

    it("the same highlight survives projectPublicState — for BOTH players", () => {
        const state = stateWithModalOnStack("phase");
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const slimItem = projected.stack[0];
            // chosenModeId crossed the wire (SlimStackItem keeps it).
            expect(slimItem.chosenModeId).toBe("phase");
            const lines = getStackModeLines(slimItem);
            expect(lines, `viewer ${viewerId}`).not.toBeNull();
            expect(
                lines!.filter((l) => l.chosen).map((l) => l.modeId),
                `viewer ${viewerId} sees the chosen mode`
            ).toEqual(["phase"]);
            // The other two modes are present but not chosen (de-emphasized).
            expect(
                lines!.filter((l) => !l.chosen).map((l) => l.modeId)
            ).toEqual(["mill", "land-type"]);
        }
    });

    it("returns null for a non-modal / no-chosen-mode stack item", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // A modal spell on the stack with NO locked mode (shouldn't happen in
        // practice, but the helper must be defensive) → null.
        pushSpell(state, visionCharm.id, "p1");
        expect(getStackModeLines(state.stack[0])).toBeNull();
    });
});

// CR 603.3c (issue #2461) — a modal TRIGGERED ability announces its mode as it
// goes on the stack, and the opponent is entitled to see which mode was chosen
// before responding. Same `chosenModeId` field, same highlight, different mode
// list (`TriggeredAbility.modes` rather than `CardDefinition.modes`) — which is
// exactly what the reducer used to drop: it returned null for every ability
// stack item. The whole point is the SURFACE, so this runs the real engine
// announcement, then the real projection, then the real reducer.
describe("stack chosen-mode highlight for a modal TRIGGER (CR 603.3c, issue #2461)", () => {
    function announcedExarchTrigger(modeId: string) {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(grizzlyBears.id, {
                            id: "mine",
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(grizzlyBears.id, {
                            id: "theirs",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
            activePlayerId: "p1",
        });
        state.stack.push({
            id: "exarch-trig",
            card: { id: deceiverExarch.id },
            controllerId: "p1",
            ownerId: "p1",
            castById: "p1",
            zone: "stack",
            types: [],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
            triggeredAbilityId: "deceiver-exarch-etb",
            triggerSourceId: "exarch",
        } as (typeof state.stack)[number]);
        // The engine raises the mode choice; the controller answers it through
        // the same entry point the mutation uses.
        raiseTriggerTargetSelection(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [modeId],
        });
        return state;
    }

    it("shows the announced trigger mode highlighted — through projectPublicState, for BOTH players", () => {
        const state = announcedExarchTrigger("tap-theirs");
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const slimItem = projected.stack.find(
                (s) => s.id === "exarch-trig"
            )!;
            expect(slimItem.chosenModeId, `viewer ${viewerId}`).toBe(
                "tap-theirs"
            );
            const lines = getStackModeLines(slimItem);
            expect(lines, `viewer ${viewerId}`).not.toBeNull();
            expect(lines!.map((l) => [l.modeId, l.chosen])).toEqual([
                ["untap-yours", false],
                ["tap-theirs", true],
            ]);
            expect(lines!.find((l) => l.chosen)!.oracleText).toBe(
                "Tap target permanent an opponent controls."
            );
        }
    });
});
