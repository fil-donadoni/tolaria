// CN2 (Conspiracy: Take the Crown, 2016) — white card behavior tests (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import { palaceJailer } from "../white";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import { resolveTopOfStack, becomeMonarch } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

describe("Palace Jailer — become the monarch + exile-until-monarch-changes (CR 720, issue #1199)", () => {
    it("becomes the monarch and exiles the sole legal opposing creature on ETB", () => {
        const bear = getCardByName("Grizzly Bears");
        const victim = makeInstance(bear.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, palaceJailer.id, "p1");
        resolveTopOfStack(state);
        // CR 603.3b (ADR 0058) — the two simultaneous ETB triggers under one
        // controller suspend on a trigger-order choice; land the batch (this
        // also auto-selects the exile trigger's sole legal target, CR 603.3d).
        resolveTriggerOrder(state);
        expect(state.stack).toHaveLength(2);
        while (state.stack.length > 0) {
            resolveTopOfStack(state);
        }

        expect(state.monarchId).toBe("p1");
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(1);
        expect(state.players[1].exile[0].id).toBe("victim");
        expect(state.monarchReturnWatch).toHaveLength(1);
        expect(state.monarchReturnWatch![0].controllerId).toBe("p1");
    });

    it("the exiled creature does NOT return when Palace Jailer itself leaves the battlefield (official ruling)", () => {
        const bear = getCardByName("Grizzly Bears");
        const victim = makeInstance(bear.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, palaceJailer.id, "p1");
        resolveTopOfStack(state);
        resolveTriggerOrder(state);
        while (state.stack.length > 0) resolveTopOfStack(state);

        // Palace Jailer leaves play — the hold is untouched (the watch is keyed
        // to the monarch designation changing, not this permanent's zone).
        state.players[0].battlefield = [];
        expect(state.players[1].exile).toHaveLength(1);
        expect(state.monarchReturnWatch).toHaveLength(1);
    });

    it("releases the exiled creature the moment an opponent becomes the monarch", () => {
        const bear = getCardByName("Grizzly Bears");
        const victim = makeInstance(bear.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, palaceJailer.id, "p1");
        resolveTopOfStack(state);
        resolveTriggerOrder(state);
        while (state.stack.length > 0) resolveTopOfStack(state);

        becomeMonarch(state, "p2");

        expect(state.players[1].exile).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield[0].id).toBe("victim");
        expect(state.monarchReturnWatch).toBeUndefined();
    });

    it("the Monarch designation survives the wire projection (issue #1199)", () => {
        const bear = getCardByName("Grizzly Bears");
        const victim = makeInstance(bear.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, palaceJailer.id, "p1");
        resolveTopOfStack(state);
        resolveTriggerOrder(state);
        while (state.stack.length > 0) resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.monarchId).toBe("p1");
    });
});
