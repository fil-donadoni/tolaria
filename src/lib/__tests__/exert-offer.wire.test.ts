// CR 613.1f / 701.43d — the client's exert affordance reads the SAME authority
// as the server's `exertableAttackerIds`, on the PROJECTED permanent. An
// attacker that lost its abilities (Humility, driven through the layer system)
// offers no exert, so the client never shows a button the `toggleExert`
// mutation refuses. Every assertion reads `projectPublicState`: a hand-built
// view would mask an `abilitiesSuppressedBy` the wire drops.

import { describe, expect, it } from "vitest";
import { anyAttackerOffersExert } from "../exert-offer";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import {
    beginApplyingStaticEffects,
    recomputeContinuousEffects,
    removePermanentTo,
    type GameState,
} from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";

const GLORYBRINGER = getCardByName("Glorybringer").id;
const HUMILITY = getCardByName("Humility").id;

function board(): GameState {
    const own = (cardId: string, id: string) =>
        makeInstance(cardId, {
            id,
            zone: "battlefield",
            controllerId: "p1",
            ownerId: "p1",
        });
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [own(GLORYBRINGER, "dragon")] }),
            makePlayer("p2"),
        ],
    });
}

function suppress(state: GameState): void {
    const humility = makeInstance(HUMILITY, {
        id: "suppressor",
        zone: "battlefield",
        controllerId: "p1",
        ownerId: "p1",
    });
    state.players[0].battlefield.push(humility);
    beginApplyingStaticEffects(state, humility);
    recomputeContinuousEffects(state);
}

function clientOffersExert(state: GameState): boolean {
    const projected = projectPublicState(state, 1, "p1");
    const battlefield = projected.players[0]
        .battlefield as unknown as CardInstance[];
    return anyAttackerOffersExert(battlefield, ["dragon"]);
}

describe("exert affordance on the projected board (CR 613.1f / 701.43d)", () => {
    it("offers exert for a declared exert attacker with its abilities", () => {
        expect(clientOffersExert(board())).toBe(true);
    });

    it("offers no exert while Humility strips the attacker's abilities, and offers it again once Humility leaves", () => {
        const state = board();
        suppress(state);
        expect(clientOffersExert(state)).toBe(false);

        removePermanentTo(state, "suppressor", "graveyard");
        recomputeContinuousEffects(state);
        expect(clientOffersExert(state)).toBe(true);
    });
});
