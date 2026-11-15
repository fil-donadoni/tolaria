// The outside-game play permission (CR 400.11b): "You may play a card you own
// from outside the game this turn" — the engine capability under the Wish
// cards, with no card exposing it yet (the Op is issue #9473).
//
//   CR 400.11   An object is outside the game if it isn't in any of the
//               game's zones. Outside the game is not a zone.
//   CR 400.11b  Some effects bring cards into a game from outside the game.
//   CR 116.2a   Playing a land is a special action … puts that land onto the
//               battlefield from the zone it was in.
//   CR 305.2b   A player can't play a land, for any reason, if the number of
//               lands the player can play this turn is equal to or less than
//               the number of lands they have already played this turn.
//   CR 514.2    … all "until end of turn" and "this turn" effects end.
//
// The permission is set through the `grantOutsideGamePlays` SpellContext
// primitive; legality is asked of `getLegalActions`, the land play goes
// through `applyPlayLandFromAnyZone`, and the surface assertions traverse
// `projectPublicState`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    buildSpellContext,
    getPlayer,
    type GameState,
    type StackItem,
} from "../state";
import { getLegalActions } from "../rules";
import { applyPlayLandFromAnyZone } from "../playLand";
import { finalizeCleanup } from "../phases";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";

const BEARS = getCardByName("Grizzly Bears").id;
const FOREST = getCardByName("Forest").id;
const BOLT = getCardByName("Lightning Bolt").id;

const pool = (defId: string, id: string) =>
    makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "exile",
    });

/** p1 owns Grizzly Bears, a Forest and a Lightning Bolt outside the game, with
 *  {R}{G}{G} floating; p1's precombat main unless overridden. */
function board(overrides: Partial<GameState> = {}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 2, C: 0 },
                outsideGame: [
                    pool(BEARS, "sb-bears"),
                    pool(FOREST, "sb-forest"),
                    pool(BOLT, "sb-bolt"),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    });
}

function grant(state: GameState, count = 1) {
    const granter: StackItem = {
        ...makeInstance(BEARS, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        }),
        castById: "p1",
        targets: [],
    };
    buildSpellContext(state, granter).grantOutsideGamePlays("p1", count);
}

function actionsFor(state: GameState, id: string) {
    const p1 = getPlayer(state, "p1");
    const card = p1.outsideGame!.find((c) => c.id === id)!;
    return getLegalActions(state, p1, card);
}

describe("outside-game play permission — legality (CR 400.11b)", () => {
    it("offers nothing outside the game without the permission", () => {
        const state = board();
        expect(actionsFor(state, "sb-bears")).toEqual([]);
        expect(actionsFor(state, "sb-forest")).toEqual([]);
    });

    it("casts a nonland card and plays a land under the permission", () => {
        const state = board();
        grant(state);
        expect(state.outsideGamePlaysThisTurn).toEqual({ p1: 1 });
        expect(actionsFor(state, "sb-bears")).toEqual(["cast"]);
        expect(actionsFor(state, "sb-forest")).toEqual(["play"]);
    });

    it("keeps normal timing: no sorcery-speed cast or land play on a non-empty stack, an instant still casts", () => {
        const state = board();
        grant(state);
        pushSpell(state, BOLT, "p2", [{ type: "player", id: "p1" }]);
        expect(actionsFor(state, "sb-bears")).toEqual([]);
        expect(actionsFor(state, "sb-forest")).toEqual([]);
        expect(actionsFor(state, "sb-bolt")).toEqual(["cast"]);
    });

    it("keeps the cost: an unaffordable card is not castable", () => {
        const state = board();
        grant(state);
        getPlayer(state, "p1").manaPool.G = 0;
        expect(actionsFor(state, "sb-bears")).toEqual([]);
    });

    it("counts the land play against the land drop (CR 305.2b)", () => {
        const state = board();
        grant(state);
        getPlayer(state, "p1").landsPlayedThisTurn = 1;
        expect(actionsFor(state, "sb-forest")).toEqual([]);
    });
});

describe("outside-game play permission — exactly one card", () => {
    it("a land play spends the permission and uses the land drop; the rest stays outside the game", () => {
        const state = board();
        grant(state);
        const p1 = getPlayer(state, "p1");
        expect(applyPlayLandFromAnyZone(state, p1, "sb-forest")).not.toBeNull();
        expect(p1.battlefield.map((c) => c.id)).toEqual(["sb-forest"]);
        expect(p1.hand).toEqual([]);
        expect(p1.landsPlayedThisTurn).toBe(1);
        expect(state.outsideGamePlaysThisTurn).toBeUndefined();
        expect(p1.outsideGame!.map((c) => c.id)).toEqual([
            "sb-bears",
            "sb-bolt",
        ]);
        expect(actionsFor(state, "sb-bears")).toEqual([]);
    });

    it("two grants are two plays", () => {
        const state = board();
        grant(state);
        grant(state);
        expect(state.outsideGamePlaysThisTurn).toEqual({ p1: 2 });
        applyPlayLandFromAnyZone(state, getPlayer(state, "p1"), "sb-forest");
        expect(actionsFor(state, "sb-bears")).toEqual(["cast"]);
    });
});

describe("outside-game play permission — lifetime (CR 514.2)", () => {
    it("ends at cleanup, and an unplayed card is still outside the game", () => {
        const state = board();
        grant(state);
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        state.phase = "PRECOMBAT_MAIN";
        expect(state.outsideGamePlaysThisTurn).toBeUndefined();
        expect(getPlayer(state, "p1").outsideGame).toHaveLength(3);
        expect(actionsFor(state, "sb-bears")).toEqual([]);
    });

    it("survives the persistence round-trip", () => {
        const state = board();
        grant(state, 2);
        const back = expandState(compactState(state));
        expect(back.outsideGamePlaysThisTurn).toEqual({ p1: 2 });
    });
});

describe("outside-game play permission — the wire (CR 400.11b)", () => {
    it("the owner's view carries the pool with its legal actions", () => {
        const state = board();
        grant(state);
        const mine = projectPublicState(state, 1, "p1").players[0]!;
        expect(
            mine.outsideGamePlayable?.map((c) => [c.id, c.legalActions])
        ).toEqual([
            ["sb-bears", ["cast"]],
            ["sb-forest", ["play"]],
            ["sb-bolt", ["cast"]],
        ]);
    });

    it("the opponent sees nothing, and nothing is projected without the permission", () => {
        const state = board();
        grant(state);
        const theirs = projectPublicState(state, 1, "p2").players[0]!;
        expect(theirs.outsideGamePlayable).toBeUndefined();
        expect(theirs.outsideGame).toBeUndefined();
        const ungranted = board();
        expect(
            projectPublicState(ungranted, 1, "p1").players[0]!
                .outsideGamePlayable
        ).toBeUndefined();
    });
});
