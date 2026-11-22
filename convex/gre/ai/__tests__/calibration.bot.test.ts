// The calibration search (issue #10451): a fixed search on a fixed board that
// reads no catalogue card, the same every time it runs.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { handWrittenSetCodeOf } from "../../../cards/catalogue";
import { isPackedRowId } from "../../../cards/packedCorpus";
import { PLACEHOLDER_CARD_ID } from "../../constants";
import { enumerateMoves } from "../../moves";
import { searchWithTrace } from "../../search";
import {
    CALIBRATION_BOT,
    CALIBRATION_BUDGET_MS,
    CALIBRATION_MAX_UNITS,
    CALIBRATION_SEED,
    CALIBRATION_UNIT_ITERATIONS,
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
        iterations: CALIBRATION_UNIT_ITERATIONS,
        minIterations: CALIBRATION_UNIT_ITERATIONS,
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
        expect(first.trace!.iterationsCompleted).toBe(
            CALIBRATION_UNIT_ITERATIONS
        );
        expect(first.trace!.stoppedBy).toBe("iterations");
        // The rollouts really probe: the reading covers the policy's work.
        expect(first.trace!.rolloutProbes).toBeGreaterThan(0);
        expect(second.trace!.rolloutProbes).toBe(first.trace!.rolloutProbes);
        expect(second.move).toEqual(first.move);
    });
});

// The calibration runs the real search in the same module instance a game's
// own consults use: the same token registry, the same module state. A real
// search must read exactly the same before and after one.
describe("a calibration between two real searches", () => {
    const MOUNTAIN = getCardByName("Mountain").id;
    const BOLT = getCardByName("Lightning Bolt").id;
    const BEARS = getCardByName("Grizzly Bears").id;

    function realBoard() {
        const card = (
            cardId: string,
            id: string,
            owner: string,
            zone?: "hand"
        ) =>
            makeInstance(cardId, {
                id,
                controllerId: owner,
                ownerId: owner,
                isSummoningSick: false,
                ...(zone ? { zone } : {}),
            });
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        card(BOLT, "h1", "p1", "hand"),
                        card(MOUNTAIN, "h2", "p1", "hand"),
                    ],
                    battlefield: [
                        card(MOUNTAIN, "l1", "p1"),
                        card(BEARS, "c1", "p1"),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [card(BEARS, "c2", "p2")],
                }),
            ],
        });
    }

    it("leaves the next real search as it was: the same move and the same trace, down to every candidate's numbers", () => {
        const budget = { iterations: 120 };
        const state = realBoard();
        const before = searchWithTrace(state, "p1", budget, 4242);

        expect(runCalibration()).not.toBeNull();

        const after = searchWithTrace(state, "p1", budget, 4242);
        expect(after.move).toEqual(before.move);
        // Everything the search says about its own work — iterations, the
        // rollout policy's probes (one module-wide counter the calibration
        // advances too), each candidate's visits, rewards and evaluation —
        // all but the wall clock.
        const work = (trace: NonNullable<typeof before.trace>) => ({
            ...trace,
            elapsedMs: 0,
        });
        expect(before.trace!.rolloutProbes).toBeGreaterThan(0);
        expect(work(after.trace!)).toEqual(work(before.trace!));
    });
});

describe("runCalibration", () => {
    /** A clock that advances `step` ms on every read: once to start, then
     *  once after each unit. */
    const steppingClock = (step: number) => {
        let reads = 0;
        return {
            now: () => {
                reads += 1;
                return reads * step;
            },
            reads: () => reads,
        };
    };

    it("reads the mean time per unit beside how many units it ran", () => {
        // 4 ms a unit: units run until the budget is spent.
        const reading = runCalibration(steppingClock(4).now);
        const units = Math.ceil(CALIBRATION_BUDGET_MS / 4);
        expect(reading).toEqual({
            msPerIteration: 4,
            iterations: units * CALIBRATION_UNIT_ITERATIONS,
        });
    });

    it("never runs past its budget by more than the one unit it was in", () => {
        // Whatever a unit costs on this device, the reading ends at the
        // first unit that finishes past the budget: its length is under the
        // budget plus one unit. This is the wait a consult posted behind it
        // can be made to pay.
        for (const unitMs of [1, 4, 7, 24, 25, 26, 90, 400]) {
            const clock = steppingClock(unitMs);
            const reading = runCalibration(clock.now)!;
            const length = reading.msPerIteration * reading.iterations;
            expect(length).toBeLessThan(CALIBRATION_BUDGET_MS + unitMs);
            // The clock was read once to start and once per unit: nothing
            // the reading does is outside it.
            expect(clock.reads()).toBe(1 + reading.iterations);
        }
    });

    it("runs one unit when one unit is longer than the whole budget", () => {
        const reading = runCalibration(steppingClock(90).now);
        expect(reading).toEqual({ msPerIteration: 90, iterations: 1 });
    });

    it("stops at its unit cap on a machine too fast to spend the budget", () => {
        const fast = CALIBRATION_BUDGET_MS / (CALIBRATION_MAX_UNITS * 4);
        const reading = runCalibration(steppingClock(fast).now);
        expect(reading!.iterations).toBe(
            CALIBRATION_MAX_UNITS * CALIBRATION_UNIT_ITERATIONS
        );
    });

    it("is no reading when the clock did not advance, or the search fails", () => {
        expect(runCalibration(() => 0)).toBeNull();
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
