// CR 602.5b — the Bot evaluates an activated ability's own `canActivate`
// closure instead of skipping every ability that carries one (issue #3441).
//
// Before this, `enumerateAbilityMoves` (`gre/moves.ts`) and
// `hasFlexibleActivation` (`gre/evaluate.ts`) both `continue`d on ANY closure,
// so 21 shipped non-mana abilities were unreachable: when the printed
// restriction held the server would accept the activation, and the Bot was the
// only thing refusing to try. Both sites now read
// `activationPreconditionViolation`, the predicate the mutation's legality gate
// reads, so each case is pinned as a pair — the restriction holding and the
// restriction failing, every other gate satisfied in both.
//
// The cards are FIXTURES, never special cases: nothing under test reads a card
// name. Barbarian Ring supplies a threshold closure over the controller's
// graveyard; Phyrexian Battleflies a mana-only closure over its own per-turn
// activation tally.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { enumerateMoves } from "../moves";
import { evaluateBreakdown } from "../evaluate";
import { activationPreconditionViolation } from "../activationPrecondition";
import { activateAbilityOnState } from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";

const RING = getCardByName("Barbarian Ring");
const MOUNTAIN = getCardByName("Mountain").id;
const BATTLEFLIES = getCardByName("Phyrexian Battleflies").id;
const SWAMP = getCardByName("Swamp").id;
const FILLER = getCardByName("Grizzly Bears").id;

const RING_SAC = "barbarian-ring-sac";

function inst(
    cardId: string,
    id: string,
    owner: "p1" | "p2",
    extra = {}
): CardInstanceState {
    return makeInstance(cardId, {
        controllerId: owner,
        ownerId: owner,
        id,
        isSummoningSick: false,
        ...extra,
    });
}

function graveyard(count: number): CardInstanceState[] {
    return Array.from({ length: count }, (_, i) =>
        inst(FILLER, `gy-${i}`, "p1")
    );
}

/** p1 holds priority in its own main phase with an untapped Barbarian Ring and
 *  an untapped Mountain (the `{R}` leg is affordable) and `gyCount` cards in
 *  its graveyard. */
function ringBoard(gyCount: number): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    inst(RING.id, "ring", "p1"),
                    inst(MOUNTAIN, "mtn", "p1"),
                ],
                graveyard: graveyard(gyCount),
            }),
            makePlayer("p2", {
                battlefield: [inst(FILLER, "bear", "p2")],
            }),
        ],
    });
}

function ringActivations(state: GameState) {
    return enumerateMoves(state, "p1").filter(
        (m) =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === "ring" &&
            m.abilityId === RING_SAC
    );
}

describe("enumerateAbilityMoves evaluates `canActivate` (CR 602.5b, issue #3441)", () => {
    it("offers the threshold ability with seven cards in the controller's graveyard", () => {
        expect(ringActivations(ringBoard(7)).length).toBeGreaterThan(0);
    });

    it("does NOT offer it with six", () => {
        expect(ringActivations(ringBoard(6))).toHaveLength(0);
    });

    it("agrees with the server gate on both boards — one authority", () => {
        const ability = RING.activatedAbilities!.find(
            (a) => a.id === RING_SAC
        )!;
        for (const gy of [6, 7]) {
            const state = ringBoard(gy);
            const ring = state.players[0].battlefield[0];
            const offered = ringActivations(state).length > 0;
            const legal =
                activationPreconditionViolation(state, ring, ability) === null;
            expect(offered).toBe(legal);
        }
        // The mutation refuses the six-card board through the same predicate.
        expect(() =>
            activateAbilityOnState(ringBoard(6), {
                playerId: "p1",
                cardInstanceId: "ring",
                abilityId: RING_SAC,
            } as Parameters<typeof activateAbilityOnState>[1])
        ).toThrow("Ability cannot be activated right now");
    });
});

describe("hasFlexibleActivation evaluates `canActivate` (CR 602.5b, issue #3441)", () => {
    /** p1 controls Phyrexian Battleflies ("activate no more than twice each
     *  turn") and an untapped Swamp (the `{B}` is affordable), having
     *  activated the pump `used` times this turn. */
    function fliesBoard(used: number): GameState {
        return makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [
                        inst(BATTLEFLIES, "flies", "p1", {
                            activationsThisTurn: {
                                "phyrexian-battleflies-pump": used,
                            },
                        }),
                        inst(SWAMP, "swamp", "p1"),
                    ],
                }),
                makePlayer("p2", {}),
            ],
        });
    }

    const flex = (state: GameState) =>
        evaluateBreakdown(state, "p1").self.flexibility;

    it("credits the held option while the closure holds (one activation used)", () => {
        expect(flex(fliesBoard(1))).toBeGreaterThan(0);
    });

    it("credits nothing once it fails (two used)", () => {
        expect(flex(fliesBoard(2))).toBe(0);
    });
});
