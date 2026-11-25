// CR 702.177a — the client affordance for an exhaust ability, driven through the
// REAL reducers: the server state goes through `projectPublicState`, and a
// dropped `exhaustedAbilities` field would offer a spent ability forever.
//
// The server half is `convex/__tests__/exhaustAbility.test.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import type { CardInstance } from "../../types/game";
import {
    buildTriggerStateView,
    getActivatedManaMenuEntry,
    getStackAbilities,
} from "../card-utils";

const LOOT = getCardByName("Loot, the Pathfinder");
const [MANA, DRAW, DAMAGE] = LOOT.activatedAbilities!.map((a) => a.id) as [
    string,
    string,
    string,
];

function offered(spent?: string[]) {
    const state = makeState({
        turn: 5,
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(LOOT.id, {
                        id: "loot",
                        controllerId: "p1",
                        ownerId: "p1",
                        ...(spent ? { exhaustedAbilities: spent } : {}),
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    Object.assign(state.players[0]!.manaPool, { U: 1, R: 1, G: 1 });
    const wire = projectPublicState(state, 1, "p1");
    const view = buildTriggerStateView(wire.players, wire.activePlayerId);
    const card = wire.players[0]!.battlefield[0] as CardInstance;
    return {
        stack: getStackAbilities(card, wire.phase, true, view).map((a) => a.id),
        mana: getActivatedManaMenuEntry(card, view)?.id,
    };
}

describe("client affordance — exhaust (CR 702.177a)", () => {
    it("offers every unspent ability", () => {
        expect(offered()).toEqual({ stack: [DRAW, DAMAGE], mana: MANA });
    });

    it("drops a spent stack ability only", () => {
        expect(offered([DRAW])).toEqual({ stack: [DAMAGE], mana: MANA });
    });

    it("drops a spent mana ability only", () => {
        expect(offered([MANA])).toEqual({
            stack: [DRAW, DAMAGE],
            mana: undefined,
        });
    });
});
