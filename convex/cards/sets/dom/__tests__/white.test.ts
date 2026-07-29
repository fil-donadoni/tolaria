// dom (Dominaria) — white behavior tests (ADR 0043 colour split).
//
// History of Benalia (issue #1879) is a DSL Saga, so the per-Op regime
// normally covers it — EXCEPT that the auto-generated canned-scenario sweep
// explicitly SKIPS its third chapter ('construct "forEach" iterates a
// runtime-selected set — covered by the card's own tests'). Per
// `.claude/rules/gre-development.md` § per-Op regime, an explicit generator
// skip IS the signal to hand-write the card's test, which is what this file
// is: chapter III's "Knights you control get +2/+1 until end of turn" driven
// through the real CR 714.3c turn-based action, asserted on the board, over
// the wire, and at the CR 514.2 cleanup boundary.
//
// The chapter I/II token itself is covered generically in
// `convex/gre/__tests__/sagas.test.ts`; here it is the SUBJECT the pump reads,
// created the way a real game creates it.

import { describe, it, expect } from "vitest";
import { historyOfBenalia } from "../white";
import { elvishArchers } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { advanceSagasAtPrecombatMain } from "../../../../gre/sagas";
import { finalizeCleanup } from "../../../../gre/phases";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { LORE_COUNTER } from "../../../abilities/sagas";

/** One CR 714.3c turn-based lore counter on the active player's Sagas, the
 *  chapter trigger it raises put on the stack (CR 603.2), and that chapter
 *  resolved — the exact pair `performPhaseEntry`'s PRECOMBAT_MAIN case runs. */
function tickChapter(state: GameState): void {
    advanceSagasAtPrecombatMain(state);
    processPendingActionTriggers(state);
    resolveTopOfStack(state);
}

const myKnight = (state: GameState): CardInstanceState =>
    state.players[0].battlefield.find(
        (c) => c.isToken && c.subtypes.includes("Knight")
    )!;

/** History of Benalia one lore counter short of chapter II, alongside a
 *  non-Knight creature of the Saga's controller and an OPPONENT's Knight —
 *  the two permanents chapter III must NOT touch. */
function benaliaBoard(): {
    state: GameState;
    saga: CardInstanceState;
    ownArcher: CardInstanceState;
    theirKnight: CardInstanceState;
} {
    const saga = makeInstance(historyOfBenalia.id, {
        id: "saga1",
        controllerId: "p1",
        counters: { [LORE_COUNTER]: 1 },
    });
    const ownArcher = makeInstance(elvishArchers.id, {
        id: "archer1",
        controllerId: "p1",
    });
    // An opponent-controlled Knight: "Knights YOU control" must skip it.
    const theirKnight = makeInstance(elvishArchers.id, {
        id: "their-knight",
        controllerId: "p2",
        ownerId: "p2",
        subtypes: ["Knight"],
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [saga, ownArcher] }),
            makePlayer("p2", { battlefield: [theirKnight] }),
        ],
        activePlayerId: "p1",
    });
    return { state, saga, ownArcher, theirKnight };
}

describe("History of Benalia — chapter III (CR 714.2, issue #1879)", () => {
    it("gives Knights you control +2/+1 until end of turn", () => {
        const { state, saga, ownArcher, theirKnight } = benaliaBoard();

        // Chapter I/II crosses at lore 2 and makes the 2/2 vigilance Knight.
        tickChapter(state);
        expect(saga.counters?.[LORE_COUNTER]).toBe(2);
        const knight = myKnight(state);
        expect(knight).toBeDefined();
        expect(getEffectivePower(state, knight)).toBe(2);
        expect(getEffectiveToughness(state, knight)).toBe(2);

        // Chapter III crosses at lore 3 and pumps.
        tickChapter(state);
        expect(saga.counters?.[LORE_COUNTER]).toBe(3);
        expect(getEffectivePower(state, knight)).toBe(4);
        expect(getEffectiveToughness(state, knight)).toBe(3);

        // "Knights YOU control": neither a non-Knight of yours nor the
        // opponent's Knight is touched.
        expect(getEffectivePower(state, ownArcher)).toBe(2);
        expect(getEffectiveToughness(state, ownArcher)).toBe(1);
        expect(getEffectivePower(state, theirKnight)).toBe(2);
        expect(getEffectiveToughness(state, theirKnight)).toBe(1);
    });

    it("wire format: the pumped Knight reads 4/3 after projectPublicState", () => {
        const { state } = benaliaBoard();
        tickChapter(state);
        tickChapter(state);
        const knightId = myKnight(state).id;

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === knightId
        )!;
        expect(slim).toBeDefined();
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("the pump wears off at cleanup (CR 514.2)", () => {
        const { state } = benaliaBoard();
        tickChapter(state);
        tickChapter(state);
        const knight = myKnight(state);
        expect(getEffectivePower(state, knight)).toBe(4);

        state.phase = "CLEANUP";
        finalizeCleanup(state);

        expect(getEffectivePower(state, knight)).toBe(2);
        expect(getEffectiveToughness(state, knight)).toBe(2);
    });
});
