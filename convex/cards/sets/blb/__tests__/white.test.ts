// BLB — white cards (ADR 0043 colour split).
//
// Intrepid Rabbit is the catalogue's first Offspring card (CR 702.175, issue
// #2079). The KEYWORD's own proof is `cards/abilities/__tests__/offspring.test.ts`,
// driven on an offspring-only probe so its P/T claims measure one mechanic; what
// this file owes is the shipped card end to end, with its SECOND Oracle line in
// play — the composition, which is exactly what no per-mechanic test sees.
import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../../../../game";
import {
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getDefinition } from "../../../registry";

// ADR 0046 — the subject is resolved through the REGISTRY seam, never by
// importing the module's export: a test that reads the definition object
// directly is blind to every transformation the registry applies on the way
// out (`scripts/__tests__/card-test-seam-boundary.test.ts`).
const intrepidRabbit = getDefinition("4d70b99d-c8bf-4a56-8957-cf587fe60b81");

const RABBIT_ID = "rab1";

/** Casts Intrepid Rabbit through the real commit path, paying its offspring
 *  cost or not, resolves the creature spell and drains its ETB triggers. */
function playRabbit(payOffspring: boolean): GameState {
    const card = makeInstance(intrepidRabbit.id, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        id: RABBIT_ID,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [card],
                // CR 601.2f — {2}{W} printed, plus {1} for the offspring cost.
                manaPool: {
                    W: 1,
                    U: 0,
                    B: 0,
                    R: 0,
                    G: 0,
                    C: payOffspring ? 3 : 2,
                },
            }),
            makePlayer("p2"),
        ],
    });
    finalizeTargetSelection(
        state,
        {
            playerId: "p1",
            cardInstanceId: RABBIT_ID,
            targetType: "any",
            count: 0,
            selected: [],
            ...(payOffspring ? { kickerPayments: { offspring: 1 } } : {}),
        },
        "p1"
    );
    resolveTopOfStack(state);
    let guard = 0;
    while (guard++ < 32) {
        processPendingActionTriggers(state);
        resolveTriggerOrder(state);
        if (state.stack.length === 0) break;
        resolveTopOfStack(state);
    }
    expect(guard, "trigger drain did not terminate").toBeLessThan(32);
    return state;
}

const battlefield = (state: GameState): CardInstanceState[] =>
    getPlayer(state, "p1").battlefield;

describe("Intrepid Rabbit (CR 702.175 / 603.2)", () => {
    it("with the offspring cost paid, arrives beside a 1/1 token copy of itself", () => {
        const state = playRabbit(true);
        const tokens = battlefield(state).filter((c) => c.isToken === true);
        expect(tokens, "no offspring token").toHaveLength(1);
        // CR 707.2 — the token presents the Rabbit's own definition, so it
        // carries the name, types, subtypes and rules text with it.
        expect(tokens[0]!.card.id).toBe(intrepidRabbit.id);
        expect(tokens[0]!.subtypes).toEqual(["Rabbit", "Soldier"]);
        // CR 707.2's "except it's 1/1".
        expect(getEffectivePower(state, tokens[0]!)).toBe(1);
        expect(getEffectiveToughness(state, tokens[0]!)).toBe(1);
    });

    it("its own ETB pump is a SEPARATE Oracle line and resolves alongside (CR 603.2)", () => {
        // Two Oracle lines, two `TriggeredAbility` entries, both firing off one
        // PERMANENT_ENTERED event; CR 603.3b's two-part process has their one
        // controller put them on the stack in an order of their own choosing.
        // The pump announces its target when it is put on the stack (CR 603.3d),
        // at which moment the Rabbit is the only creature its controller
        // controls — the token does not exist yet — so it targets the Rabbit.
        const state = playRabbit(true);
        const original = battlefield(state).find((c) => c.id === RABBIT_ID)!;
        expect(getEffectivePower(state, original)).toBe(3 + 1);
        expect(getEffectiveToughness(state, original)).toBe(2 + 1);
        // The pump is a CR 613 layer-7c effect on ONE permanent, so the token
        // it did not target keeps the copy's printed 1/1.
        const token = battlefield(state).find((c) => c.isToken === true)!;
        expect(getEffectivePower(state, token)).toBe(1);
    });

    it("with the offspring cost declined, only the Rabbit arrives", () => {
        const state = playRabbit(false);
        expect(
            battlefield(state).filter((c) => c.isToken === true),
            "a declined offspring cost still made a token"
        ).toHaveLength(0);
        const original = battlefield(state).find((c) => c.id === RABBIT_ID)!;
        expect(original.unkickedCostPayments).toBeUndefined();
        // The second line is unconditional — it fires either way.
        expect(getEffectivePower(state, original)).toBe(3 + 1);
    });
});
