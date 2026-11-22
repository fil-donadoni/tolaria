// The calibration search (issue #10451): a fixed search on a fixed board that
// reads no catalogue card, the same every time it runs.

import { describe, expect, it } from "vitest";
import { handWrittenSetCodeOf } from "../../../cards/catalogue";
import { isPackedRowId } from "../../../cards/packedCorpus";
import { PLACEHOLDER_CARD_ID } from "../../constants";
import { enumerateMoves } from "../../moves";
import { searchWithTrace } from "../../search";
import {
    CALIBRATION_BOT,
    CALIBRATION_CAP_MS,
    CALIBRATION_ITERATIONS,
    CALIBRATION_SEED,
    calibrationState,
    runCalibration,
} from "../calibration";

/** Every card the board holds, in every zone of both seats. */
function boardCardIds(): string[] {
    const state = calibrationState();
    return state.players.flatMap((player) =>
        [
            player.hand,
            player.library,
            player.graveyard,
            player.exile,
            player.battlefield,
        ].flatMap((zone) => zone.map((card) => String(card.card.id)))
    );
}

describe("the calibration board", () => {
    it("names no catalogue card: tokens and hidden-card placeholders only", () => {
        const ids = boardCardIds();
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) {
            // Neither a hand-written Set's card nor a compiled row: nothing a
            // Definition Shard would have to be installed for.
            expect(handWrittenSetCodeOf(id)).toBeUndefined();
            expect(isPackedRowId(id)).toBe(false);
        }
        const permanents = calibrationState().players.flatMap(
            (player) => player.battlefield
        );
        expect(permanents).toHaveLength(4);
        expect(ids.filter((id) => id === PLACEHOLDER_CARD_ID).length).toBe(
            ids.length - permanents.length
        );
    });

    it("puts a real decision before the Bot: its attack, four ways", () => {
        const state = calibrationState();
        expect(state.phase).toBe("DECLARE_ATTACKERS");
        const moves = enumerateMoves(state, CALIBRATION_BOT);
        expect(moves.map((move) => move.kind)).toEqual([
            "declare-attackers",
            "declare-attackers",
            "declare-attackers",
            "declare-attackers",
        ]);
    });

    it("is the same board on every call", () => {
        expect(calibrationState()).toEqual(calibrationState());
    });
});

describe("the calibration search", () => {
    const budget = {
        iterations: CALIBRATION_ITERATIONS,
        minIterations: CALIBRATION_ITERATIONS,
    };

    it("does the same work on a repeat: iterations, probes and pick", () => {
        const first = searchWithTrace(
            calibrationState(),
            CALIBRATION_BOT,
            budget,
            CALIBRATION_SEED
        );
        const second = searchWithTrace(
            calibrationState(),
            CALIBRATION_BOT,
            budget,
            CALIBRATION_SEED
        );
        expect(first.trace!.iterationsCompleted).toBe(CALIBRATION_ITERATIONS);
        expect(first.trace!.stoppedBy).toBe("iterations");
        // The rollouts really probe: the reading covers the policy's work.
        expect(first.trace!.rolloutProbes).toBeGreaterThan(0);
        expect(second.trace!.rolloutProbes).toBe(first.trace!.rolloutProbes);
        expect(second.move).toEqual(first.move);
    });
});

describe("runCalibration", () => {
    it("reads the time per completed iteration off the search's own clock", () => {
        // A clock that advances 3 ms per read: the search reads it once to
        // start, once per iteration for the cap, and once to finish.
        let t = 0;
        const reading = runCalibration(() => (t += 3));
        expect(reading).not.toBeNull();
        expect(reading!.iterations).toBe(CALIBRATION_ITERATIONS);
        // 16 iterations and the closing read: 17 steps of 3 ms.
        expect(reading!.msPerIteration).toBeCloseTo(
            (3 * (CALIBRATION_ITERATIONS + 1)) / CALIBRATION_ITERATIONS,
            6
        );
    });

    it("stops at its cap, and still reads the iterations it completed", () => {
        // 150 ms per read: the first iteration already ends past the cap.
        let t = 0;
        const reading = runCalibration(() => (t += 150));
        expect(CALIBRATION_CAP_MS).toBeLessThanOrEqual(150);
        expect(reading!.iterations).toBe(1);
        // One iteration, and the closing read: two steps of 150 ms.
        expect(reading!.msPerIteration).toBe(300);
    });

    it("is no reading when the search fails, and never throws", () => {
        expect(
            runCalibration(() => {
                throw new Error("no clock");
            })
        ).toBeNull();
    });

    it("times a real run", () => {
        const reading = runCalibration();
        expect(reading!.iterations).toBeGreaterThan(0);
        expect(reading!.msPerIteration).toBeGreaterThan(0);
    });
});
