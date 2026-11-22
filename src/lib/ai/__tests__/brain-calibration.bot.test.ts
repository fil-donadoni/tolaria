// The calibration message of the Brain channel (issue #10451): the Worker's
// handler, and the page's side of it in `brain-client.ts` — a reading from a
// running Worker, and no reading in every other case, always settled.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
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
    it("answers with the search's reading under the request's id", () => {
        expect(
            handleCalibration({ kind: "calibrate", id: 7 }, () => ({
                msPerIteration: 2.5,
                iterations: 16,
            }))
        ).toEqual({ kind: "calibration", id: 7, msPerIteration: 2.5 });
    });

    it("answers with no reading when the search measured nothing or threw", () => {
        expect(
            handleCalibration({ kind: "calibrate", id: 8 }, () => null)
        ).toEqual({ kind: "calibration", id: 8, msPerIteration: null });
        expect(
            handleCalibration({ kind: "calibrate", id: 9 }, () => {
                throw new Error("engine fault");
            })
        ).toEqual({ kind: "calibration", id: 9, msPerIteration: null });
    });

    it("runs the real calibration search by default", () => {
        // On the real clock: under the suite's fake timers no time passes.
        vi.useRealTimers();
        const answer = handleCalibration({ kind: "calibrate", id: 1 });
        expect(answer.msPerIteration).toBeGreaterThan(0);
    });

    it("tells its two messages from a consult's", () => {
        expect(isBrainCalibrate({ kind: "calibrate", id: 1 })).toBe(true);
        expect(isBrainCalibrate({ id: 1, state: {}, botId: "b" })).toBe(false);
        expect(isBrainCalibrate({ kind: "prime", entries: [] })).toBe(false);
        expect(
            isBrainCalibration({
                kind: "calibration",
                id: 1,
                msPerIteration: 2,
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
            msPerIteration: 2.5,
        });
        await expect(reading).resolves.toBe(2.5);
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
            msPerIteration: null,
        });
        await expect(empty).resolves.toBeNull();

        const malformed = calibrateBrain();
        worker.answer({
            kind: "calibration",
            id: worker.posted[1]!.id,
            msPerIteration: "fast",
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
            msPerIteration: 3,
        });
        await expect(reading).resolves.toBe(3);

        worker.answer({ id: consultMessage!.id, move: null, trace: null });
        await expect(consult).resolves.toMatchObject({ outcome: "no-move" });
    });
});
