/**
 * `activatedDamageReach` and its one consumer, `lethalUnblockedDelta`
 * (issue #10422): a confirmed block that leaves the defender inside the
 * attacker's on-board activated burn reach is the same loss as one whose
 * combat damage alone is lethal — whatever the burn source's cost shape.
 *
 * CR references: 120.3a (damage dealt to a player causes that much life
 * loss), 302.6 (a creature's {T} ability waits out summoning sickness),
 * 510.1b (an unblocked creature assigns its combat damage to the player it
 * attacks), 704.5a (a player at 0 or less life loses).
 */

import { describe, expect, it } from "vitest";
import { WIN_SCORE, lethalUnblockedDelta } from "../evaluate";
import { activatedDamageReach } from "../ai/activatedDamageReach";
import type { CardInstanceState, GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";

const ATTACKER = "p1";
const DEFENDER = "p2";
const VANILLA = getCardByName("Grizzly Bears").id;
const MOUNTAIN = getCardByName("Mountain").id;
/** {R}, Sacrifice: 2 damage to any target. */
const SPELLBOMB = getCardByName("Pyrite Spellbomb").id;
/** Haste; {T}: 1 damage to any target. */
const HASTY_PINGER = getCardByName("Vulshok Sorcerer").id;
/** No haste; {T}: 1 damage to any target. */
const PINGER = getCardByName("Vithian Stinger").id;
/** Sacrifice: 1 damage to any target — no mana. */
const SAC_PINGER = getCardByName("Mogg Fanatic").id;

/** A 3/2 attacker, unblocked, into `defenderLife`, blockers confirmed — the
 *  issue's shape: three damage through, the rest of the attacker's board
 *  (`extra`) left home. */
function position(defenderLife: number, extra: CardInstanceState[]): GameState {
    const attacker = makeInstance(VANILLA, {
        id: "atk",
        controllerId: ATTACKER,
        power: 3,
        toughness: 2,
        isAttacking: true,
        isTapped: true,
    });
    const state = makeState({
        players: [
            makePlayer(ATTACKER, { battlefield: [attacker, ...extra] }),
            makePlayer(DEFENDER, { life: defenderLife }),
        ],
        activePlayerId: ATTACKER,
    });
    state.combat = {
        attackerIds: ["atk"],
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: true,
    };
    state.phase = "DECLARE_BLOCKERS";
    return state;
}

const own = (cardId: string, overrides: Partial<CardInstanceState> = {}) =>
    makeInstance(cardId, { controllerId: ATTACKER, ...overrides });

const reach = (state: GameState) =>
    activatedDamageReach(state, state.players[0], state.players[1]);

describe("lethalUnblockedDelta — activated burn reach (issue #10422, CR 120.3a / 704.5a)", () => {
    it("a sacrifice-and-mana burn artifact turns 3 damage into 5 lethal", () => {
        const state = position(5, [own(SPELLBOMB), own(MOUNTAIN)]);
        expect(reach(state)).toBe(2);
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
        expect(lethalUnblockedDelta(state, ATTACKER)).toBe(WIN_SCORE);
    });

    it("a {T} creature pinger is the same class (CR 302.6: haste lifts sickness)", () => {
        const state = position(4, [
            own(HASTY_PINGER, { isSummoningSick: true }),
        ]);
        expect(reach(state)).toBe(1);
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
    });

    it("a mana-free sacrifice pinger is the same class", () => {
        const state = position(4, [own(SAC_PINGER)]);
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
    });

    it("is zero when the burn is one point short", () => {
        const state = position(6, [own(SPELLBOMB), own(MOUNTAIN)]);
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("is zero when the activation cannot be paid", () => {
        expect(
            lethalUnblockedDelta(position(5, [own(SPELLBOMB)]), DEFENDER)
        ).toBe(0);
        expect(
            lethalUnblockedDelta(
                position(5, [
                    own(SPELLBOMB),
                    own(MOUNTAIN, { isTapped: true }),
                ]),
                DEFENDER
            )
        ).toBe(0);
    });

    it("spends the mana once across several sources", () => {
        const one = position(7, [
            own(SPELLBOMB),
            own(SPELLBOMB),
            own(MOUNTAIN),
        ]);
        expect(reach(one)).toBe(2);
        expect(lethalUnblockedDelta(one, DEFENDER)).toBe(0);
        const two = position(7, [
            own(SPELLBOMB),
            own(SPELLBOMB),
            own(MOUNTAIN),
            own(MOUNTAIN),
        ]);
        expect(reach(two)).toBe(4);
        expect(lethalUnblockedDelta(two, DEFENDER)).toBe(-WIN_SCORE);
    });

    it("never counts a tapped, summoning-sick or attacking {T} source", () => {
        expect(reach(position(4, [own(PINGER, { isTapped: true })]))).toBe(0);
        expect(
            reach(position(4, [own(PINGER, { isSummoningSick: true })]))
        ).toBe(0);
        expect(reach(position(4, [own(PINGER)]))).toBe(1);
        const attacking = position(4, [
            own(HASTY_PINGER, { id: "ping", isAttacking: true }),
        ]);
        attacking.combat!.attackerIds.push("ping");
        attacking.combat!.blockerAssignments = {};
        expect(reach(attacking)).toBe(0);
    });

    it("reads nothing outside a confirmed declare-blockers window", () => {
        const state = position(5, [own(SPELLBOMB), own(MOUNTAIN)]);
        state.phase = "COMBAT_DAMAGE";
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });
});
