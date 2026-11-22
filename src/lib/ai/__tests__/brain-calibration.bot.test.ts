// The calibration message of the Brain channel (issue #10451): the Worker's
// handler, and the page's side of it in `brain-client.ts` — a reading from a
// running Worker, and no reading in every other case, always settled.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import {
    CALIBRATION_BUDGET_MS,
    runCalibration,
} from "@convex/gre/ai/calibration";
import {
    handleCalibration,
    isBrainCalibrate,
    isBrainCalibration,
} from "../brain-calibration";
import {
    BRAIN_CALIBRATION_TIMEOUT_MS,
    calibrateBrain,
    consultBrain,
    disposeBrain,
    warmBrain,
} from "../brain-client";

describe("handleCalibration", () => {
    it("answers with the calibration's reading under the request's id", () => {
        expect(
            handleCalibration({ kind: "calibrate", id: 7 }, () => ({
                msPerIteration: 2.5,
                iterations: 9,
            }))
        ).toEqual({
            kind: "calibration",
            id: 7,
            reading: { msPerIteration: 2.5, iterations: 9 },
        });
    });

    it("answers with no reading when the calibration measured nothing, threw, or returned a number nobody can use", () => {
        const none = (id: number) => ({
            kind: "calibration",
            id,
            reading: null,
        });
        expect(
            handleCalibration({ kind: "calibrate", id: 8 }, () => null)
        ).toEqual(none(8));
        expect(
            handleCalibration({ kind: "calibrate", id: 9 }, () => {
                throw new Error("engine fault");
            })
        ).toEqual(none(9));
        for (const bad of [
            { msPerIteration: 0, iterations: 4 },
            { msPerIteration: Number.NaN, iterations: 4 },
            { msPerIteration: 2.5, iterations: 0 },
            { msPerIteration: 2.5, iterations: 1.5 },
        ]) {
            expect(
                handleCalibration({ kind: "calibrate", id: 10 }, () => bad)
            ).toEqual(none(10));
        }
    });

    it("runs the real calibration by default", () => {
        // On the real clock: under the suite's fake timers no time passes.
        vi.useRealTimers();
        const answer = handleCalibration({ kind: "calibrate", id: 1 });
        expect(answer.reading!.msPerIteration).toBeGreaterThan(0);
        expect(answer.reading!.iterations).toBeGreaterThan(0);
    });

    // The wait a consult posted behind a calibration can be made to pay is
    // the handler's whole length. With the REAL calibration behind it and a
    // clock that charges every unit the same, that length stays under the
    // budget plus one unit, whatever a unit costs on the device.
    it("lasts no longer than its budget plus one unit, on the real calibration", () => {
        for (const unitMs of [2, 10, 24, 26, 60, 250]) {
            let reads = 0;
            const now = () => {
                reads += 1;
                return reads * unitMs;
            };
            const answer = handleCalibration({ kind: "calibrate", id: 2 }, () =>
                runCalibration(now)
            );
            const reading = answer.reading!;
            // Every clock read but the first closes a unit: the handler's
            // length on this clock is the units it ran, nothing beside them.
            expect(reads).toBe(1 + reading.iterations);
            const length = (reads - 1) * unitMs;
            expect(length).toBeLessThan(CALIBRATION_BUDGET_MS + unitMs);
            expect(reading.msPerIteration).toBe(unitMs);
        }
    });

    it("tells its two messages from a consult's", () => {
        expect(isBrainCalibrate({ kind: "calibrate", id: 1 })).toBe(true);
        expect(isBrainCalibrate({ id: 1, state: {}, botId: "b" })).toBe(false);
        expect(isBrainCalibrate({ kind: "prime", entries: [] })).toBe(false);
        expect(
            isBrainCalibration({
                kind: "calibration",
                id: 1,
                reading: { msPerIteration: 2, iterations: 3 },
            })
        ).toBe(true);
        expect(isBrainCalibration({ id: 1, move: null, trace: null })).toBe(
            false
        );
    });
});

// ── The page's side ─────────────────────────────────────────────────────────

type Posted = { kind?: string; id: number };

/** A Worker whose answers the test decides, message by message. */
class ScriptedWorker {
    static last: ScriptedWorker | null = null;
    static built = 0;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    posted: Posted[] = [];
    constructor() {
        ScriptedWorker.last = this;
        ScriptedWorker.built += 1;
    }
    postMessage(message: Posted) {
        this.posted.push(message);
    }
    terminate() {}
    answer(data: unknown) {
        this.onmessage?.({ data });
    }
}

const originalWorker = globalThis.Worker;

beforeEach(() => {
    vi.useFakeTimers();
    ScriptedWorker.last = null;
    ScriptedWorker.built = 0;
    (globalThis as { Worker?: unknown }).Worker =
        ScriptedWorker as unknown as typeof Worker;
});

afterEach(() => {
    disposeBrain();
    (globalThis as { Worker?: unknown }).Worker = originalWorker;
    vi.useRealTimers();
});

describe("calibrateBrain", () => {
    it("asks the running Worker and resolves with its reading", async () => {
        warmBrain();
        const worker = ScriptedWorker.last!;
        const reading = calibrateBrain();
        expect(worker.posted).toHaveLength(1);
        expect(worker.posted[0]).toMatchObject({ kind: "calibrate" });

        worker.answer({
            kind: "calibration",
            id: worker.posted[0]!.id,
            reading: { msPerIteration: 2.5, iterations: 9 },
        });
        await expect(reading).resolves.toEqual({
            msPerIteration: 2.5,
            iterations: 9,
        });
    });

    it("never spawns a Worker to ask, and has no reading without one", async () => {
        await expect(calibrateBrain()).resolves.toBeNull();
        expect(ScriptedWorker.built).toBe(0);

        // No `Worker` at all — the in-thread path of a test or SSR: no
        // calibration runs on this thread.
        (globalThis as { Worker?: unknown }).Worker = undefined;
        await expect(calibrateBrain()).resolves.toBeNull();
    });

    it("has no reading from an answer that carries none", async () => {
        warmBrain();
        const worker = ScriptedWorker.last!;
        const empty = calibrateBrain();
        worker.answer({
            kind: "calibration",
            id: worker.posted[0]!.id,
            reading: null,
        });
        await expect(empty).resolves.toBeNull();

        const malformed = calibrateBrain();
        worker.answer({
            kind: "calibration",
            id: worker.posted[1]!.id,
            reading: { msPerIteration: "fast", iterations: 3 },
        });
        await expect(malformed).resolves.toBeNull();
    });

    it("settles with no reading when the Worker never answers", async () => {
        warmBrain();
        const reading = calibrateBrain();
        await vi.advanceTimersByTimeAsync(BRAIN_CALIBRATION_TIMEOUT_MS + 1);
        await expect(reading).resolves.toBeNull();
    });

    it("settles with no reading when the Worker dies or the Brain is disposed", async () => {
        warmBrain();
        const dying = calibrateBrain();
        ScriptedWorker.last!.onerror?.({ message: "Script error" });
        await expect(dying).resolves.toBeNull();

        warmBrain();
        const disposed = calibrateBrain();
        disposeBrain();
        await expect(disposed).resolves.toBeNull();
    });

    it("keeps a calibration and a consult apart on the one channel", async () => {
        warmBrain();
        const worker = ScriptedWorker.last!;
        const consult = consultBrain({} as unknown as PublicGameState, "u1-p2");
        const reading = calibrateBrain();
        const [consultMessage, calibrateMessage] = worker.posted;
        expect(calibrateMessage).toMatchObject({ kind: "calibrate" });
        expect(consultMessage!.id).not.toBe(calibrateMessage!.id);

        // The calibration's answer settles the calibration only.
        worker.answer({
            kind: "calibration",
            id: calibrateMessage!.id,
            reading: { msPerIteration: 3, iterations: 4 },
        });
        await expect(reading).resolves.toEqual({
            msPerIteration: 3,
            iterations: 4,
        });

        worker.answer({ id: consultMessage!.id, move: null, trace: null });
        await expect(consult).resolves.toMatchObject({ outcome: "no-move" });
    });
});
