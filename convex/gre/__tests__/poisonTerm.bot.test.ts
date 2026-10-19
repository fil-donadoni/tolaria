/**
 * The Brain's poison model (issue #5153): the `poison` evaluation term, the
 * poison half of `dangerClock` and the poison branch of `lethalUnblockedDelta`.
 *
 * CR references: 702.90b (infect damage to a player is poison counters),
 * 704.5c (ten or more poison counters loses the game).
 */

import { describe, it, expect } from "vitest";
import {
    WIN_SCORE,
    evaluate,
    evaluateBreakdown,
    lethalUnblockedDelta,
} from "../evaluate";
import { dangerClock } from "../dangerClock";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import type { GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";

const ATTACKER = "p1";
const DEFENDER = "p2";
const VANILLA = getCardByName("Grizzly Bears").id;
const LIBRARY_CARD = getCardByName("Forest").id;

/** One attacker (`p1`) facing a creatureless defender (`p2`) at `poison`
 *  counters and 20 life. With `declared`, the attack is declared and blocks
 *  are confirmed — the window `lethalUnblockedDelta` reads. */
function board(opts: {
    poison: number;
    power: number;
    infect: boolean;
    declared?: boolean;
    defenderLife?: number;
}): GameState {
    const attacker = makeInstance(VANILLA, {
        id: "a0",
        controllerId: ATTACKER,
        power: opts.power,
        toughness: 2,
        isAttacking: opts.declared ?? false,
        staticAbilities: opts.infect ? ["infect"] : [],
    });
    const state = makeState({
        players: [
            makePlayer(ATTACKER, { battlefield: [attacker] }),
            makePlayer(DEFENDER, {
                life: opts.defenderLife ?? 20,
                poisonCounters: opts.poison,
            }),
        ],
        activePlayerId: ATTACKER,
    });
    if (opts.declared) {
        state.combat = {
            attackerIds: ["a0"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
        };
        state.phase = "DECLARE_BLOCKERS";
    }
    return state;
}

describe("the poison term (CR 704.5c)", () => {
    const at = (poison: number) =>
        evaluate(board({ poison, power: 2, infect: false }), DEFENDER);

    it("scores a position at 8 poison below the same position at 0", () => {
        expect(at(8)).toBeLessThan(at(0));
    });

    it("climbs steeper as the counters near ten", () => {
        const step = (n: number) => at(n) - at(n + 1);
        expect(step(8)).toBeGreaterThan(step(1));
    });

    it("is EXACTLY zero with no poison, and the library term still prices a short library", () => {
        const state = board({ poison: 0, power: 2, infect: false });
        const me = state.players.find((p) => p.id === DEFENDER)!;
        me.library = Array.from({ length: 10 }, (_, i) =>
            makeInstance(LIBRARY_CARD, { id: `lib${i}` })
        );
        const { self } = evaluateBreakdown(state, DEFENDER);
        expect(self.poison).toBe(0);
        expect(self.library).toBeLessThan(0);
    });

    it("reads ten poison counters as a loss", () => {
        expect(at(10)).toBeLessThan(-WIN_SCORE / 2);
    });

    it("mirrors: the opponent's poison is the viewer's gain", () => {
        const viewAttacker = (poison: number) =>
            evaluate(board({ poison, power: 2, infect: false }), ATTACKER);
        expect(viewAttacker(8)).toBeGreaterThan(viewAttacker(0));
    });

    it("is priced by poisonWeight", () => {
        const zero = { ...DEFAULT_EVAL_WEIGHTS, poisonWeight: 0 };
        const state = board({ poison: 8, power: 2, infect: false });
        const clean = board({ poison: 0, power: 2, infect: false });
        expect(evaluate(state, DEFENDER, zero)).toBe(
            evaluate(clean, DEFENDER, zero)
        );
    });
});

describe("lethalUnblockedDelta — poison-lethal (CR 702.90b / 704.5c)", () => {
    it("reports lethal for an unblocked 3-power infect attacker into 7 poison", () => {
        const state = board({
            poison: 7,
            power: 3,
            infect: true,
            declared: true,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
        expect(lethalUnblockedDelta(state, ATTACKER)).toBe(WIN_SCORE);
    });

    it("is zero one counter short of the tenth", () => {
        const state = board({
            poison: 6,
            power: 3,
            infect: true,
            declared: true,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("never reads infect damage as life loss", () => {
        const state = board({
            poison: 0,
            power: 3,
            infect: true,
            declared: true,
            defenderLife: 3,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });
});

describe("dangerClock — the poison race (CR 702.90b)", () => {
    it("an infect attacker one hit from the tenth counter is a full lethal clock", () => {
        const near = dangerClock(
            board({ poison: 8, power: 2, infect: true }),
            DEFENDER
        );
        const far = dangerClock(
            board({ poison: 0, power: 2, infect: true }),
            DEFENDER
        );
        const vanilla = dangerClock(
            board({ poison: 8, power: 2, infect: false }),
            DEFENDER
        );
        expect(near).toBeLessThan(far);
        expect(near).toBeLessThan(vanilla);
    });

    it("takes the faster of the life and poison races, never their sum", () => {
        // 10 power into 20 life and 5 infect power into 0 poison: each race
        // is half done per combat, so the board is a two-combat clock, not a
        // one-combat lethal one.
        const state = board({ poison: 0, power: 5, infect: true });
        const attacker = state.players.find((p) => p.id === ATTACKER)!;
        attacker.battlefield.push(
            makeInstance(VANILLA, {
                id: "a1",
                controllerId: ATTACKER,
                power: 10,
                toughness: 2,
            })
        );
        const full = dangerClock(
            board({ poison: 0, power: 20, infect: false }),
            DEFENDER
        );
        expect(dangerClock(state, DEFENDER)).toBeGreaterThan(full);
    });
});
