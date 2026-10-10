// Per-player "can't play lands this turn" restriction (issue #2145, Turf Wound).
// CR 305.1 (playing a land), CR 101.2 ("can't" beats "can"), CR 305.4 (putting
// a land onto the battlefield is not playing one), CR 514.2 (cleanup expiry).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import { projectPublicState } from "../../gameProjections";
import { getLegalActions } from "../rules";
import {
    canLandEnterBattlefield,
    resolveTopOfStack,
    type GameState,
} from "../state";

const mountain = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56");
const exploration = getDefinition("2f09e451-0246-45a2-8bfd-07d3c65ddfe6");
const turfWound = getDefinition("91392e9f-f96a-4ac5-b1f1-c73540cf249e");

function landInHand(owner: string) {
    return makeInstance(mountain.id, {
        id: `land-${owner}`,
        controllerId: owner,
        ownerId: owner,
        zone: "hand",
    });
}

/** p1 and p2 each hold a land; `active` has the turn, Turf Wound on p2. */
function setup(active: "p1" | "p2"): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", { hand: [landInHand("p1")] }),
            makePlayer("p2", { hand: [landInHand("p2")] }),
        ],
        activePlayerId: active,
        priorityPlayerId: active,
        phase: "PRECOMBAT_MAIN",
    });
    return state;
}

function castTurfWound(state: GameState, caster: string, target: string) {
    pushSpell(state, turfWound.id, caster, [{ type: "player", id: target }]);
    resolveTopOfStack(state);
}

const playOf = (state: GameState, pid: string) => {
    const player = state.players.find((p) => p.id === pid)!;
    return getLegalActions(state, player, player.hand[0]);
};

describe("restrictLandPlay — Turf Wound (CR 305.1 / 101.2, issue #2145)", () => {
    it("the targeted player has no `play` action", () => {
        const state = setup("p2");
        expect(playOf(state, "p2")).toContain("play");
        castTurfWound(state, "p1", "p2");
        expect(state.cannotPlayLandsThisTurn).toEqual(["p2"]);
        expect(playOf(state, "p2")).not.toContain("play");
    });

    it("is per-player: the other player still plays a land the same turn", () => {
        const state = setup("p1");
        castTurfWound(state, "p1", "p2");
        expect(playOf(state, "p1")).toContain("play");
    });

    it("CR 101.2: an extra-land-drop effect resolving afterwards does not lift it", () => {
        const state = setup("p2");
        castTurfWound(state, "p1", "p2");
        state.players[1].battlefield.push(
            makeInstance(exploration.id, {
                id: "expl",
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            })
        );
        expect(playOf(state, "p2")).not.toContain("play");
    });

    it("CR 305.4: a land put onto the battlefield by an effect still may enter", () => {
        const state = setup("p2");
        castTurfWound(state, "p1", "p2");
        expect(canLandEnterBattlefield(state, ["Land"])).toBe(true);
    });

    it("the lock reaches the wire: hand land projects without `play`", () => {
        const state = setup("p2");
        castTurfWound(state, "p1", "p2");
        const projected = projectPublicState(state, 1, "p2")!;
        expect(projected.cannotPlayLandsThisTurn).toEqual(["p2"]);
        const me = projected.players.find((p) => p.id === "p2")!;
        expect(me.hand![0]!.legalActions).not.toContain("play");
    });
});
