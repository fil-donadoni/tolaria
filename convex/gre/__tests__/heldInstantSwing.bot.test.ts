// Issue #10331 — the rollout default policy reads a held instant as a combat
// trick only when casting it could change the declared exchange (ADR 0021
// slice 3's ambush line, narrowed). Position: issue #9956's — Mons's Goblin
// Raiders (1/1) against an untapped Serra Angel (4/4), the opponent at 1 life.
// CR 120.6 / 704.5g: damage marked on the Angel counts toward lethal, so 2
// damage plus the Raiders' 1 leaves it alive and 3 plus 1 kills it.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { enumerateMoves, type Move } from "../moves";
import { heldInstantSwingsExchange, selectRolloutMove } from "../search";
import type { CardInstanceState, GameState } from "../state";

const RAIDERS = getCardByName("Mons's Goblin Raiders").id; // {R} 1/1
const ANGEL = getCardByName("Serra Angel").id; // 4/4 flying, vigilance
const UNHOLY_HEAT = getCardByName("Unholy Heat").id; // {R}: 2, delirium 6
const BOLT = getCardByName("Lightning Bolt").id; // {R}: 3
const GIANT_GROWTH = getCardByName("Giant Growth").id; // {G}: +3/+3
const OPT = getCardByName("Opt").id; // {U}: scry 1, draw
const MOUNTAIN = getCardByName("Mountain").id;
const FOREST = getCardByName("Forest").id;
const ISLAND = getCardByName("Island").id;

const LAND_FOR: Record<string, string> = {
    [UNHOLY_HEAT]: MOUNTAIN,
    [BOLT]: MOUNTAIN,
    [GIANT_GROWTH]: FOREST,
    [OPT]: ISLAND,
};

function permanent(cardId: string, controllerId: string, id: string) {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        id,
        isSummoningSick: false,
    });
}

/** Issue #9956's board, with `held` in the Bot's hand and the one land that
 *  pays for it. `attacking` declares the Raiders' attack (confirmed, no
 *  blocks); otherwise the Bot is about to declare. The graveyard is empty, so
 *  Unholy Heat's delirium is off (CR 207.2c). */
function position(held: string, attacking: boolean): GameState {
    const raiders: CardInstanceState = {
        ...permanent(RAIDERS, "p1", "raiders"),
        ...(attacking ? { isAttacking: true } : {}),
    };
    return makeState({
        phase: "DECLARE_ATTACKERS",
        turn: 5,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(held, {
                        controllerId: "p1",
                        ownerId: "p1",
                        id: "held",
                        zone: "hand",
                    }),
                ],
                battlefield: [raiders, permanent(LAND_FOR[held], "p1", "land")],
            }),
            makePlayer("p2", {
                life: 1,
                battlefield: [permanent(ANGEL, "p2", "angel")],
            }),
        ],
        combat: {
            attackerIds: attacking ? ["raiders"] : [],
            confirmed: attacking,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function attacksWithRaiders(move: Move): boolean {
    return (
        move.kind === "declare-attackers" &&
        move.attackerIds.includes("raiders")
    );
}

/** The greedy policy's pick from the pre-declaration window. `rng` 0 takes
 *  the first of a tie, so a tie between attacking and not cannot hide. */
function greedyPick(held: string): Move {
    const state = position(held, false);
    return selectRolloutMove(
        state,
        "p1",
        "p1",
        enumerateMoves(state, "p1"),
        () => 0
    );
}

describe("selectRolloutMove — a held instant is a trick only if it swings the exchange (issue #10331)", () => {
    it("does not send the Raiders into the Angel holding 2 damage it cannot make lethal", () => {
        expect(attacksWithRaiders(greedyPick(UNHOLY_HEAT))).toBe(false);
    });

    it("still baits the block holding a pump that wins the exchange", () => {
        expect(attacksWithRaiders(greedyPick(GIANT_GROWTH))).toBe(true);
    });
});

describe("heldInstantSwingsExchange (issue #10331)", () => {
    it("is false for burn that leaves the blocker alive after combat damage", () => {
        expect(heldInstantSwingsExchange(position(UNHOLY_HEAT, true))).toBe(
            false
        );
    });

    it("is true for burn the attacker's combat damage makes lethal", () => {
        expect(heldInstantSwingsExchange(position(BOLT, true))).toBe(true);
    });

    it("is true for a pump that lets the attacker trade with its blocker", () => {
        expect(heldInstantSwingsExchange(position(GIANT_GROWTH, true))).toBe(
            true
        );
    });

    it("is false for an instant with no combat effect", () => {
        expect(heldInstantSwingsExchange(position(OPT, true))).toBe(false);
    });

    it("is false with no declared attack", () => {
        expect(heldInstantSwingsExchange(position(GIANT_GROWTH, false))).toBe(
            false
        );
    });
});
