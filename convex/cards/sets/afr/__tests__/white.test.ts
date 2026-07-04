// AFR (Adventures in the Forgotten Realms) — white card behavior tests
// (ADR 0043 colour split). Each card's describe block cites the CR section
// it exercises.
import { describe, it, expect } from "vitest";
import { portableHole } from "../white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    removePermanentTo,
    processPendingActionTriggers,
    resolveTopOfStack,
    type StackItem,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { resolveTrigger, submitChoice } from "./helpers";

// Black Lotus — {0} artifact, mv 0 ≤ 2, a legal Portable Hole target.
const CHEAP_ARTIFACT_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe";

const ETB_EVENT: StackItem["triggerEvent"] = {
    type: "PERMANENT_ENTERED",
    instanceId: "ph",
    controllerId: "p1",
    types: ["Artifact"],
} as StackItem["triggerEvent"];

function setup() {
    const ph = makeInstance(portableHole.id, {
        id: "ph",
        controllerId: "p1",
        ownerId: "p1",
    });
    const cheap = makeInstance(CHEAP_ARTIFACT_ID, {
        id: "cheap",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [ph] }),
            makePlayer("p2", { battlefield: [cheap] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, ph };
}

describe("Portable Hole (AFR — exile-until-leaves scoped to mv<=2, CR 603.6a/603.7a)", () => {
    it("is a {W} Artifact with the modern oracle text", () => {
        expect(portableHole.manaCost).toEqual({ W: 1 });
        expect(portableHole.types).toEqual(["Artifact"]);
        expect(portableHole.oracleText).toBe(
            "When this artifact enters, exile target nonland permanent an opponent controls with mana value 2 or less until this artifact leaves the battlefield."
        );
    });

    it("ETB exiles the chosen mana-value-2-or-less permanent (CR 603.6a)", () => {
        const { state, ph } = setup();
        resolveTrigger(state, ph, "portable-hole-exile", ETB_EVENT);
        submitChoice(state, ["cheap"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "cheap")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("cheap");
        const bundle = state.exileHeld?.find((b) => b.sourceId === "ph");
        expect(bundle?.hostId).toBe("cheap");
    });

    it("returns the exiled permanent when Portable Hole leaves (CR 603.7a)", () => {
        const { state, ph } = setup();
        resolveTrigger(state, ph, "portable-hole-exile", ETB_EVENT);
        submitChoice(state, ["cheap"]);

        removePermanentTo(state, "ph", "graveyard");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "portable-hole-return"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);

        expect(
            state.players[1].battlefield.find((c) => c.id === "cheap")
        ).toBeDefined();
        expect(state.exileHeld ?? []).toHaveLength(0);
        checkStateBasedActions(state);
    });

    it("wire: the exiled permanent is pinned to Portable Hole via exiledByPermanentId, for both viewers", () => {
        const { state, ph } = setup();
        resolveTrigger(state, ph, "portable-hole-exile", ETB_EVENT);
        submitChoice(state, ["cheap"]);

        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const exiledCard = projected.players[1].exile.find(
                (c) => c.id === "cheap"
            )!;
            expect(exiledCard.exiledByPermanentId).toBe("ph");
        }
    });
});
