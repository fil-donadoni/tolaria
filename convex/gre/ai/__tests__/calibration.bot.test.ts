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
import { getDefinition, tokenDefinitionId } from "../../../cards/registry";
import { createTokenPermanents } from "../../state";
import { isPackedRowId } from "../../../cards/packedCorpus";
import { PLACEHOLDER_CARD_ID } from "../../constants";
import { enumerateMoves } from "../../moves";
import { searchWithTrace } from "../../search";
import {
    CALIBRATION_BOT,
    CALIBRATION_BUDGET_MS,
    CALIBRATION_MAX_UNITS,
    CALIBRATION_SEED,
    CALIBRATION_TOKENS,
    CALIBRATION_UNIT_ITERATIONS,
    CALIBRATION_WORK,
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
// own consults use: the same token registry, the same module state. Two
// guards, built so that neither depends on what ran before them in this
// worker (bot tests share one module registry across files):
//
//   1. the REGISTRY. A token's definition is registered under an id derived
//      from its spec, and the first registration of an id wins. The
//      calibration's tokens carry a name no real token has, so their ids are
//      theirs alone: whenever the calibration first runs, it can never be the
//      first to register an id a game's own token then resolves to.
//   2. everything else. A real search on a board that itself creates tokens
//      reads exactly the same before and after a calibration.
describe("the calibration's tokens", () => {
    /** The token a real card would make with the same characteristics: the
     *  calibration's spec under its plain name. */
    const plainTwin = (token: (typeof CALIBRATION_TOKENS)[number]) => ({
        ...token,
        name: token.name.replace(/^Calibration /, ""),
    });

    it("are named for the calibration, so their definition ids are no real token's", () => {
        expect(CALIBRATION_TOKENS.length).toBeGreaterThan(0);
        const calibrationIds = CALIBRATION_TOKENS.map(tokenDefinitionId);
        for (const token of CALIBRATION_TOKENS) {
            expect(token.name).toMatch(/^Calibration /);
            // A 2/2 green Bear a real card makes has the id the calibration's
            // token would have had under that name.
            expect(calibrationIds).not.toContain(
                tokenDefinitionId(plainTwin(token))
            );
        }
    });

    it("leave a real token of the same characteristics its own definition, after a calibration", () => {
        expect(runCalibration()).not.toBeNull();
        const state = calibrationState();
        for (const token of CALIBRATION_TOKENS) {
            const real = plainTwin(token);
            createTokenPermanents(state, real, CALIBRATION_BOT, 1);
            const definition = getDefinition(tokenDefinitionId(real));
            expect(definition.name).toBe(real.name);
            expect(definition).not.toBe(
                getDefinition(tokenDefinitionId(token))
            );
        }
    });
});

describe("a calibration between two real searches", () => {
    const MOUNTAIN = getCardByName("Mountain").id;
    const BOLT = getCardByName("Lightning Bolt").id;
    const BEARS = getCardByName("Grizzly Bears").id;
    // "{5}, {T}: Create a 1/1 colorless Insect artifact creature token with
    // flying named Wasp": a board whose own search creates tokens.
    const HIVE = getCardByName("The Hive").id;

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
                    hand: [card(BOLT, "h1", "p1", "hand")],
                    battlefield: [
                        card(HIVE, "hive", "p1"),
                        card(BEARS, "c1", "p1"),
                        ...[1, 2, 3, 4, 5, 6].map((n) =>
                            card(MOUNTAIN, `l${n}`, "p1")
                        ),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [card(BEARS, "c2", "p2")],
                }),
            ],
        });
    }

    it("searches a board that can make a token of its own", () => {
        const { trace } = searchWithTrace(
            realBoard(),
            "p1",
            { iterations: 120 },
            4242
        );
        expect(trace!.candidates.some((c) => /The Hive/.test(c.label))).toBe(
            true
        );
    });

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

    /** A clock that advances only with WORK: `buildMs` each time the board
     *  is built, `searchMs` each time it is searched, through the real work
     *  wrapped. Reading it costs nothing, so work done before the clock's
     *  first read or after its last is time the reading did not see. */
    const workClock = (buildMs: number, searchMs: number) => {
        let t = 0;
        const readAt: number[] = [];
        return {
            now: () => {
                readAt.push(t);
                return t;
            },
            work: {
                build: () => {
                    t += buildMs;
                    return CALIBRATION_WORK.build();
                },
                search: (state: ReturnType<typeof calibrationState>) => {
                    t += searchMs;
                    return CALIBRATION_WORK.search(state);
                },
            },
            /** All the work done, read or not. */
            spent: () => t,
            readAt: () => readAt,
        };
    };

    it("times everything it does: the board and the search of every unit, and nothing outside the clock", () => {
        for (const [buildMs, searchMs] of [
            [1, 3],
            [5, 2],
            [0.5, 30],
            [40, 200],
        ] as const) {
            const clock = workClock(buildMs, searchMs);
            const reading = runCalibration(clock.now, clock.work)!;
            // No work before the clock started, none after its last read.
            expect(clock.readAt()[0]).toBe(0);
            const reads = clock.readAt();
            expect(reads[reads.length - 1]).toBe(clock.spent());
            // So a unit reads as all of its work: board and search.
            expect(reading.msPerUnit).toBeCloseTo(buildMs + searchMs, 9);
            expect(clock.spent()).toBeCloseTo(
                reading.units * (buildMs + searchMs),
                9
            );
            // And the reading's whole length — the wait a consult posted
            // behind it can be made to pay — is under the budget plus one
            // unit of this device's.
            expect(clock.spent()).toBeLessThan(
                CALIBRATION_BUDGET_MS + buildMs + searchMs
            );
        }
    });

    it("reads the mean time per unit beside how many units it ran", () => {
        // 4 ms a unit: units run until the budget is spent.
        const reading = runCalibration(steppingClock(4).now);
        expect(reading).toEqual({
            msPerUnit: 4,
            units: Math.ceil(CALIBRATION_BUDGET_MS / 4),
        });
    });

    it("never runs past its budget by more than the one unit it was in", () => {
        for (const unitMs of [1, 4, 7, 24, 25, 26, 90, 400]) {
            const clock = steppingClock(unitMs);
            const reading = runCalibration(clock.now)!;
            const length = reading.msPerUnit * reading.units;
            expect(length).toBeLessThan(CALIBRATION_BUDGET_MS + unitMs);
            expect(clock.reads()).toBe(1 + reading.units);
        }
    });

    it("runs one unit when one unit is longer than the whole budget", () => {
        const reading = runCalibration(steppingClock(90).now);
        expect(reading).toEqual({ msPerUnit: 90, units: 1 });
    });

    it("stops at its unit cap on a machine too fast to spend the budget", () => {
        const fast = CALIBRATION_BUDGET_MS / (CALIBRATION_MAX_UNITS * 4);
        const reading = runCalibration(steppingClock(fast).now);
        expect(reading!.units).toBe(CALIBRATION_MAX_UNITS);
    });

    it("is no reading when the clock did not advance, a unit did not search, or the work fails", () => {
        expect(runCalibration(() => 0)).toBeNull();
        expect(
            runCalibration(steppingClock(4).now, {
                build: CALIBRATION_WORK.build,
                search: () => false,
            })
        ).toBeNull();
        expect(
            runCalibration(() => {
                throw new Error("no clock");
            })
        ).toBeNull();
    });

    it("times a real run", () => {
        const reading = runCalibration();
        expect(reading!.units).toBeGreaterThan(0);
        expect(reading!.msPerUnit).toBeGreaterThan(0);
    });
});
