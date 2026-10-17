// Trample overflow is face damage in both block-quality seams (issue #5785).
//
// CR 702.19b — a blocked attacker with trample assigns lethal damage to every
// blocker first; the excess reaches the player it attacks. CR 702.19d — with
// no blocker left, all of it does. `lethalUnblockedDelta` (the leaf lethality
// term) and `declaredBlockDelta` (the block-quality exchange) used to count a
// blocked attacker as dealing the player nothing, so a 2/1 + 1/1 double-block
// of a 4/3 trampler at 2 life read as "no face damage" while the engine
// tramples 2 over and the defender dies (CR 704.5a).
import { describe, expect, it } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import type { CardType } from "../../cards/types";
import {
    WIN_SCORE,
    declaredBlockDelta,
    lethalUnblockedDelta,
} from "../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { makePlayer, makeState } from "../../cards/__tests__/setup.helper";

const ATTACKER = "p1";
const DEFENDER = "p2";

function creature(
    id: string,
    controllerId: string,
    power: number,
    toughness: number,
    staticAbilities: string[] = []
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        power,
        toughness,
        staticAbilities,
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
        isAttacking: controllerId === ATTACKER,
        isBlocking: controllerId === DEFENDER,
    };
}

/** p1 attacks with `atk`; every one of `blockers` blocks it. */
function blockState(
    atk: CardInstanceState,
    blockers: CardInstanceState[],
    defenderLife: number
): GameState {
    return makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: ATTACKER,
        players: [
            makePlayer(ATTACKER, { battlefield: [atk] }),
            makePlayer(DEFENDER, {
                battlefield: blockers,
                life: defenderLife,
            }),
        ],
        combat: {
            attackerIds: [atk.id],
            confirmed: true,
            blockerAssignments: Object.fromEntries(
                blockers.map((b) => [b.id, [atk.id]])
            ),
            blockersConfirmed: true,
            blockedAttackerIds: blockers.length > 0 ? [atk.id] : undefined,
        },
    });
}

const trampler = (abilities: string[] = ["trample"]) =>
    creature("atk", ATTACKER, 4, 3, abilities);
const pair = () => [
    creature("b21", DEFENDER, 2, 1),
    creature("b11", DEFENDER, 1, 1),
];

describe("lethalUnblockedDelta — trample overflow (CR 702.19b, issue #5785)", () => {
    it("is the loss score when the overflow past two chumps is lethal", () => {
        const state = blockState(trampler(), pair(), 2);
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
        expect(lethalUnblockedDelta(state, ATTACKER)).toBe(WIN_SCORE);
    });

    it("is zero for the same block without trample", () => {
        const state = blockState(trampler([]), pair(), 2);
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("is zero when one 3/3 absorbs all but 1 of 4 at 2 life", () => {
        const state = blockState(
            trampler(),
            [creature("b33", DEFENDER, 3, 3)],
            2
        );
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("counts full power when every blocker has left (CR 702.19d)", () => {
        const state = blockState(trampler(), pair(), 4);
        state.players[1]!.battlefield = [];
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
    });

    it("excludes a trampler aimed at a planeswalker (CR 508.1b)", () => {
        const state = blockState(trampler(), pair(), 2);
        state.combat!.attackTargets = { atk: "pw1" };
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("declines under an unspent player prevention shield (CR 615.1)", () => {
        const state = blockState(trampler(), pair(), 2);
        state.playerDamagePrevention = [
            { playerId: DEFENDER, remaining: 1 },
        ] as GameState["playerDamagePrevention"];
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });
});

describe("declaredBlockDelta — trample overflow (CR 702.19b, issue #5785)", () => {
    const life = DEFAULT_EVAL_WEIGHTS.lifeWeight;

    it("charges the overflow past a chump as face damage", () => {
        const chump = () => [creature("b11", DEFENDER, 1, 1)];
        const plain = declaredBlockDelta(
            blockState(trampler([]), chump(), 20),
            DEFENDER
        );
        const tramples = declaredBlockDelta(
            blockState(trampler(), chump(), 20),
            DEFENDER
        );
        expect(plain - tramples).toBeCloseTo(3 * life);
    });

    it("owes lethal to EVERY blocker before overflow, killable or not", () => {
        // 4 power into a 5/5 and a 1/1: lethal owed is 6, nothing tramples.
        const blockers = () => [
            creature("b55", DEFENDER, 0, 5),
            creature("b11", DEFENDER, 0, 1),
        ];
        const plain = declaredBlockDelta(
            blockState(trampler([]), blockers(), 20),
            DEFENDER
        );
        const tramples = declaredBlockDelta(
            blockState(trampler(), blockers(), 20),
            DEFENDER
        );
        expect(tramples).toBeCloseTo(plain);
    });

    it("deathtouch + trample: 1 per blocker is lethal, the rest tramples (CR 702.2c)", () => {
        const blocker = () => [creature("b33", DEFENDER, 0, 3)];
        const atk = (abilities: string[]) =>
            creature("atk", ATTACKER, 4, 4, abilities);
        const trample = declaredBlockDelta(
            blockState(atk(["trample"]), blocker(), 20),
            DEFENDER
        );
        const deadly = declaredBlockDelta(
            blockState(atk(["trample", "deathtouch"]), blocker(), 20),
            DEFENDER
        );
        // 1 over the 3/3 without deathtouch, 3 over it with.
        expect(trample - deadly).toBeCloseTo(2 * life);
    });
});
