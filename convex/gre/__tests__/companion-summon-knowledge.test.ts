// Companion summon visibility (ADR 0026, CR 702.139a, issue #8735): a Companion
// moved from the Companion Slot to Hand by the {3} special action stays known
// to every Player — face-up in the opponent's view of that Hand, eye badge in
// the owner's. Both the authoritative mutation's move (`moveCompanionToHand`,
// shared with game.ts) and the Bot's `summonCompanionInSearch` are asserted.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { moveCompanionToHand } from "../companion";
import { summonCompanionInSearch } from "../applyMove";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { lutri } from "../../cards/sets/iko/multicolor.cards";
import { getCardByName } from "../../cards";
import type { GameState } from "../state";

const MOUNTAIN = getCardByName("Mountain").id;
const FOREST = getCardByName("Forest").id;

function board(): GameState {
    const p1 = makePlayer("p1", {
        battlefield: [1, 2, 3].map(() =>
            makeInstance(MOUNTAIN, { controllerId: "p1", ownerId: "p1" })
        ),
        hand: [
            makeInstance(FOREST, { controllerId: "p1", ownerId: "p1" }),
            makeInstance(FOREST, { controllerId: "p1", ownerId: "p1" }),
        ],
        companion: {
            instance: makeInstance(lutri().id, {
                controllerId: "p1",
                ownerId: "p1",
            }),
            used: false,
        },
    });
    return makeState({ players: [p1, makePlayer("p2")] });
}

type Summon = (state: GameState) => void;
const SUMMONS: Array<[string, Summon]> = [
    [
        "moveCompanionToHand (the mutation's move)",
        (s) => moveCompanionToHand(s, s.players[0]),
    ],
    [
        "summonCompanionInSearch (the Bot's copy)",
        (s) => summonCompanionInSearch(s, s.players[0]),
    ],
];

describe.each(SUMMONS)("summoned companion is known to all — %s", (_n, run) => {
    it("is known to both players the moment it enters Hand", () => {
        const state = board();
        const id = state.players[0].companion!.instance.id;
        run(state);
        const card = state.players[0].hand.find((c) => c.id === id);
        expect(card).toBeDefined();
        expect([...(card?.knownTo ?? [])].sort()).toEqual(["p1", "p2"]);
        expect(state.players[0].companion?.used).toBe(true);
    });

    it("projects face-up to the opponent, hidden siblings stay hidden", () => {
        const state = board();
        run(state);
        const hand = projectPublicState(state, 1, "p2").players.find(
            (p) => p.id === "p1"
        )!.hand;
        expect(hand).toHaveLength(3);
        const identities = hand.map((c) => c?.card?.id);
        expect(identities.filter((id) => id === lutri().id)).toHaveLength(1);
        expect(identities.indexOf(lutri().id)).toBe(2);
        expect(identities[0]).toBeUndefined();
        expect(identities[1]).toBeUndefined();
    });

    it("sets seenByOpponent on that card only, in the owner's view", () => {
        const state = board();
        run(state);
        const hand = projectPublicState(state, 1, "p1").players.find(
            (p) => p.id === "p1"
        )!.hand;
        expect(hand.map((c) => c?.seenByOpponent === true)).toEqual([
            false,
            false,
            true,
        ]);
    });

    it("survives a gameStates save and reload", () => {
        const state = board();
        run(state);
        const back = expandState(
            JSON.parse(JSON.stringify(compactState(state)))
        );
        const hand = projectPublicState(back, 1, "p2").players.find(
            (p) => p.id === "p1"
        )!.hand;
        expect(hand[2]?.card?.id).toBe(lutri().id);
        expect(hand[0]?.card?.id).toBeUndefined();
    });
});
