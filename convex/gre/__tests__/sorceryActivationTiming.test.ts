// CR 602.5d / 307.5 — "activate only as a sorcery" is asked of the ACTIVATING
// player (`isSorceryTimingFor`), not of the active player. Pins that
// `assertActivationTimingLegal` no longer leans on a caller-side check
// (issue #1722).

import { describe, it, expect } from "vitest";
import { assertActivationTimingLegal } from "../activation";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const ability = { id: "equip", sorcerySpeedOnly: true };

function frame(controllerId: string) {
    const card = makeInstance(grizzlyBears().id, {
        id: "perm1",
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, card };
}

describe("assertActivationTimingLegal sorcery window (CR 602.5d, CR 307.5)", () => {
    it("allows the active controller holding priority", () => {
        const { state, card } = frame("p1");
        expect(() =>
            assertActivationTimingLegal(state, card, card.controllerId, ability)
        ).not.toThrow();
    });

    it("refuses a non-active controller even while the active player holds priority", () => {
        const { state, card } = frame("p2");
        expect(() =>
            assertActivationTimingLegal(state, card, card.controllerId, ability)
        ).toThrow("Activate only as a sorcery");
    });

    it("asks about the activating player, not the card's stored controller (graveyard source)", () => {
        // A graveyard card keeps its last battlefield controller; its owner p1
        // activates it in their own window.
        const { state, card } = frame("p2");
        expect(() =>
            assertActivationTimingLegal(state, card, "p1", ability)
        ).not.toThrow();
    });
});
