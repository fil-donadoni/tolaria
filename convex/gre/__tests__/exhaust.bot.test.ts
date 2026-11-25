// CR 702.177a — the Bot offers an exhaust ability once: the enumerator reads the
// server's own gate, and the search's payment model spends an exhaust mana
// ability so a simulated turn cannot make its mana again.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { activatedDamageReach } from "../ai/activatedDamageReach";
import { getManaTapOptions, manaGateBattlefields } from "../constants";
import { enumerateMoves } from "../moves";
import { applyTapPlanInSearch } from "../searchTapPlan";
import type { GameState } from "../state";

const LOOT = getCardByName("Loot, the Pathfinder");
const [, DRAW, DAMAGE] = LOOT.activatedAbilities!.map((a) => a.id) as [
    string,
    string,
    string,
];

function board(spent?: string[]): GameState {
    const land = (name: string) =>
        makeInstance(getCardByName(name).id, {
            id: name,
            controllerId: "p1",
            ownerId: "p1",
        });
    return makeState({
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
                    land("Island"),
                    land("Mountain"),
                    land("Forest"),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

const offered = (state: GameState) =>
    new Set(
        enumerateMoves(state, "p1").flatMap((m) =>
            m.kind === "activate-ability" ? [m.abilityId] : []
        )
    );

describe("enumerateMoves — exhaust (CR 702.177a)", () => {
    it("offers both unspent stack abilities", () => {
        expect(offered(board())).toEqual(new Set([DRAW, DAMAGE]));
    });

    it("drops exactly the spent one", () => {
        expect(offered(board([DRAW]))).toEqual(new Set([DAMAGE]));
    });
});

describe("the search's readings of a spent exhaust ability", () => {
    it("a simulated for-mana tap spends the mana ability", () => {
        const state = board();
        const src = state.players[0]!.battlefield[0]!;
        const options = () =>
            getManaTapOptions(src, "p1", manaGateBattlefields(state)).length;
        expect(options()).toBe(5);
        applyTapPlanInSearch(state, "p1", [
            { cardInstanceId: "loot", manaChoiceIndex: 0 },
        ]);
        src.isTapped = false;
        expect(options()).toBe(0);
    });

    it("a spent damage ability is no damage reach", () => {
        const reach = (state: GameState) =>
            activatedDamageReach(state, state.players[0]!, state.players[1]!);
        expect(reach(board())).toBe(3);
        expect(reach(board([DAMAGE]))).toBe(0);
    });
});
