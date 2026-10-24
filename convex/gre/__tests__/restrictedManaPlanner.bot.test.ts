// CR 106.6 (issue #1733) — `planManaPayment` agrees with the
// castability gate about restricted mana: it counts floating restricted mana
// the cast may spend, and never taps a restricted option the cast cannot use.

import { describe, expect, it } from "vitest";
import { getCardByName, getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { planManaPayment } from "../moves";
import type { GameState } from "../state";

const SOL_RING = getDefinition(getCardByName("Sol Ring").id);
const UNSUMMON = getDefinition(getCardByName("Unsummon").id);
const WORKSHOP = getCardByName("Mishra's Workshop").id;
const HALFLING = getCardByName("Delighted Halfling").id;

const castOf = (def: typeof SOL_RING) => ({
    cardInstanceId: "spell",
    cardDef: def,
});

function board(
    sourceIds: string[],
    restrictedMana?: NonNullable<GameState["players"][number]["restrictedMana"]>
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: sourceIds.map((id, i) =>
                    makeInstance(id, { id: `src${i}` })
                ),
                restrictedMana,
            }),
            makePlayer("p2"),
        ],
    });
}

describe("planManaPayment and restricted mana (CR 106.6)", () => {
    it("pays an artifact spell from floating artifact-spell mana", () => {
        const state = board(
            [],
            [{ color: "C", amount: 1, restriction: "artifact-spell" }]
        );
        expect(
            planManaPayment(state, state.players[0], { C: 1 }, castOf(SOL_RING))
        ).toEqual([]);
        // ... and not a spell the restriction forbids.
        expect(
            planManaPayment(state, state.players[0], { U: 1 }, castOf(UNSUMMON))
        ).toBeNull();
    });

    it("taps a restricted option only for a spell it permits", () => {
        const state = board([WORKSHOP]);
        expect(
            planManaPayment(state, state.players[0], { C: 1 }, castOf(SOL_RING))
        ).toEqual([{ cardInstanceId: "src0" }]);
        expect(
            planManaPayment(state, state.players[0], { C: 1 }, castOf(UNSUMMON))
        ).toBeNull();
        // No cast named (an activation): never a restricted tap.
        expect(planManaPayment(state, state.players[0], { C: 1 })).toBeNull();
    });

    it("keeps the unrestricted option of a mixed source", () => {
        const state = board([HALFLING]);
        const plan = planManaPayment(
            state,
            state.players[0],
            { C: 1 },
            castOf(SOL_RING)
        );
        expect(plan).toHaveLength(1);
        expect(plan![0].cardInstanceId).toBe("src0");
        // The any-colour option is restricted: {U} for a non-legendary is out.
        expect(
            planManaPayment(state, state.players[0], { U: 1 }, castOf(UNSUMMON))
        ).toBeNull();
    });
});
